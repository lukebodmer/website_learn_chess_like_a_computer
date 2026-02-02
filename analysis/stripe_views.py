"""Stripe subscription management views"""
import stripe
import json
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.shortcuts import redirect
from .models import UserProfile
from django.utils import timezone

# Initialize Stripe
stripe.api_key = settings.STRIPE_SECRET_KEY
stripe.api_version = '2026-01-28.clover'  # Use latest API version for Checkout Sessions


def complete_signup_checkout(request):
    """Complete signup after successful Checkout Session"""
    session_id = request.GET.get('session_id')

    if not session_id:
        return JsonResponse({'error': 'session_id required'}, status=400)

    try:
        # Retrieve the session with expanded subscription
        session = stripe.checkout.Session.retrieve(
            session_id,
            expand=['subscription']
        )

        print(f"DEBUG: Session status={session.status}, payment_status={session.payment_status}")
        print(f"DEBUG: Session has subscription: {hasattr(session, 'subscription') and session.subscription}")

        # Verify payment was successful
        if session.status != 'complete' or session.payment_status != 'paid':
            return JsonResponse({
                'error': 'Payment not completed',
                'status': session.status,
                'payment_status': session.payment_status
            }, status=400)

        # Get signup data from session
        signup_data = request.session.get('signup_data')
        if not signup_data:
            return JsonResponse({'error': 'Signup data not found. Please start over.'}, status=400)

        # Check if account already created for this session
        from django.contrib.auth.models import User
        username = signup_data['username']
        email = signup_data['email']

        # Check if user already exists (in case of duplicate submission)
        if User.objects.filter(username=username).exists():
            user = User.objects.get(username=username)
            # Log them in and clear session
            from django.contrib.auth import login
            login(request, user)
            del request.session['signup_data']
            return JsonResponse({
                'success': True,
                'message': 'Account already created. Logged in successfully.'
            })

        # Create the user account
        user = User.objects.create_user(
            username=username,
            email=email,
            password=signup_data['password']
        )

        # Create user profile
        profile, created = UserProfile.objects.get_or_create(user=user)

        # Get subscription from session
        if session.subscription:
            # If subscription was expanded, use it directly, otherwise retrieve it
            if isinstance(session.subscription, str):
                subscription = stripe.Subscription.retrieve(session.subscription)
            else:
                subscription = session.subscription

            print(f"DEBUG: Subscription ID: {subscription.id}")
            print(f"DEBUG: Subscription status: {subscription.status}")

            # Get or create customer
            customer_id = session.customer
            profile.stripe_customer_id = customer_id
            profile.stripe_subscription_id = subscription.id
            profile.subscription_tier = signup_data['tier']
            profile.subscription_status = subscription.status

            # Get current_period_end from subscription items
            # In Stripe's API, current_period_end is on the subscription items, not the subscription itself
            try:
                # Stripe subscription objects use dictionary-style access
                if 'items' in subscription and subscription['items']:
                    items_data = subscription['items'].get('data', [])
                    if items_data and len(items_data) > 0:
                        current_period_end_timestamp = items_data[0].get('current_period_end')
                        if current_period_end_timestamp:
                            profile.subscription_current_period_end = timezone.datetime.fromtimestamp(
                                current_period_end_timestamp, tz=timezone.utc
                            )
                            print(f"✅ Set subscription_current_period_end to: {profile.subscription_current_period_end}")
                        else:
                            print(f"⚠️ WARNING: current_period_end timestamp is None")
                    else:
                        print(f"⚠️ WARNING: No subscription items data found")
                else:
                    print(f"⚠️ WARNING: No subscription items found in subscription object")
            except Exception as e:
                print(f"❌ Error accessing subscription items: {str(e)}")
                import traceback
                traceback.print_exc()

            profile.games_analyzed_this_month = 0
            profile.usage_reset_date = timezone.now().date()
            profile.save()
        else:
            print("DEBUG: No subscription found in session")

        # Log the user in
        from django.contrib.auth import login
        login(request, user)

        # Clear signup data from session
        del request.session['signup_data']

        return JsonResponse({
            'success': True,
            'message': 'Account created successfully!',
            'redirect': '/'
        })

    except stripe.error.StripeError as e:
        print(f"Stripe error completing signup: {str(e)}")
        return JsonResponse({'error': str(e.user_message)}, status=400)
    except Exception as e:
        print(f"Error completing signup: {str(e)}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()

        # Return more detailed error for debugging
        error_message = str(e) if str(e) else type(e).__name__
        return JsonResponse({'error': error_message}, status=500)


@require_POST
def create_signup_checkout_session(request):
    """Create a Checkout Session for new user signup"""
    try:
        data = json.loads(request.body)
        username = data.get('username')
        email = data.get('email')
        password1 = data.get('password1')
        password2 = data.get('password2')
        tier = data.get('tier')

        # Validate inputs
        if not all([username, email, password1, password2, tier]):
            return JsonResponse({'error': 'All fields are required'}, status=400)

        if password1 != password2:
            return JsonResponse({'error': 'Passwords do not match'}, status=400)

        if len(password1) < 8:
            return JsonResponse({'error': 'Password must be at least 8 characters'}, status=400)

        if tier not in ['standard', 'max']:
            return JsonResponse({'error': 'Invalid subscription tier'}, status=400)

        # Check if username exists
        from django.contrib.auth.models import User
        if User.objects.filter(username=username).exists():
            return JsonResponse({'error': 'Username already exists'}, status=400)

        # Check if email exists
        if User.objects.filter(email=email).exists():
            return JsonResponse({'error': 'Email already exists'}, status=400)

        # Store signup data in session
        request.session['signup_data'] = {
            'username': username,
            'email': email,
            'password': password1,
            'tier': tier,
        }

        # Determine the price ID based on tier
        price_id = settings.STRIPE_STANDARD_PRICE_ID if tier == 'standard' else settings.STRIPE_MAX_PRICE_ID

        if not price_id:
            return JsonResponse({
                'error': 'Stripe price ID not configured. Please set STRIPE_STANDARD_PRICE_ID and STRIPE_MAX_PRICE_ID in your environment.'
            }, status=500)

        # Get the site domain for return URL
        site_domain = request.build_absolute_uri('/')[:-1]

        # Create Checkout Session with embedded UI mode
        session = stripe.checkout.Session.create(
            ui_mode='embedded',
            customer_email=email,
            line_items=[
                {
                    'price': price_id,
                    'quantity': 1,
                },
            ],
            mode='subscription',
            return_url=f'{site_domain}/signup?session_id={{CHECKOUT_SESSION_ID}}',
            metadata={
                'username': username,
                'tier': tier,
                'is_signup': 'true',
            }
        )

        return JsonResponse({
            'clientSecret': session.client_secret
        })

    except stripe.error.StripeError as e:
        return JsonResponse({'error': str(e.user_message)}, status=400)
    except Exception as e:
        print(f"Error creating signup checkout session: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)


def get_stripe_config(request):
    """Return Stripe publishable key for client-side initialization"""
    return JsonResponse({
        'publishable_key': settings.STRIPE_PUBLISHABLE_KEY
    })


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """Handle Stripe webhook events"""
    payload = request.body
    sig_header = request.META.get('HTTP_STRIPE_SIGNATURE')

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError as e:
        print(f"Invalid payload: {e}")
        return HttpResponse(status=400)
    except stripe.error.SignatureVerificationError as e:
        print(f"Invalid signature: {e}")
        return HttpResponse(status=400)

    # Handle the event
    if event['type'] == 'customer.subscription.created':
        subscription = event['data']['object']
        handle_subscription_created(subscription)

    elif event['type'] == 'customer.subscription.updated':
        subscription = event['data']['object']
        handle_subscription_updated(subscription)

    elif event['type'] == 'customer.subscription.deleted':
        subscription = event['data']['object']
        handle_subscription_deleted(subscription)

    elif event['type'] == 'invoice.payment_succeeded':
        invoice = event['data']['object']
        handle_payment_succeeded(invoice)

    elif event['type'] == 'invoice.payment_failed':
        invoice = event['data']['object']
        handle_payment_failed(invoice)

    return HttpResponse(status=200)


def handle_subscription_created(subscription):
    """Handle new subscription creation"""
    customer_id = subscription.get('customer')
    subscription_id = subscription.get('id')
    status = subscription.get('status')
    tier = subscription['metadata'].get('tier')

    try:
        profile = UserProfile.objects.get(stripe_customer_id=customer_id)
        profile.stripe_subscription_id = subscription_id
        profile.subscription_tier = tier
        profile.subscription_status = status

        # Get current_period_end from subscription items
        if subscription.get('items') and subscription['items'].get('data') and len(subscription['items']['data']) > 0:
            current_period_end_timestamp = subscription['items']['data'][0].get('current_period_end')
            if current_period_end_timestamp:
                profile.subscription_current_period_end = timezone.datetime.fromtimestamp(
                    current_period_end_timestamp, tz=timezone.utc
                )

        # Reset usage counter for new subscription
        if status == 'active':
            profile.games_analyzed_this_month = 0
            profile.usage_reset_date = timezone.now().date()

        profile.save()
        print(f"✅ Subscription created for user {profile.user.username} - Tier: {tier}, Status: {status}")

    except UserProfile.DoesNotExist:
        print(f"❌ UserProfile not found for customer {customer_id}")


def handle_subscription_updated(subscription):
    """Handle subscription updates"""
    customer_id = subscription.get('customer')
    status = subscription.get('status')

    try:
        profile = UserProfile.objects.get(stripe_customer_id=customer_id)
        profile.subscription_status = status

        # Get current_period_end from subscription items
        if subscription.get('items') and subscription['items'].get('data') and len(subscription['items']['data']) > 0:
            current_period_end_timestamp = subscription['items']['data'][0].get('current_period_end')
            if current_period_end_timestamp:
                profile.subscription_current_period_end = timezone.datetime.fromtimestamp(
                    current_period_end_timestamp, tz=timezone.utc
                )

        # Update tier if price changed
        if subscription.get('items') and subscription['items']['data']:
            price_id = subscription['items']['data'][0]['price']['id']
            if price_id == settings.STRIPE_STANDARD_PRICE_ID:
                profile.subscription_tier = 'standard'
            elif price_id == settings.STRIPE_MAX_PRICE_ID:
                profile.subscription_tier = 'max'

        profile.save()
        print(f"✅ Subscription updated for user {profile.user.username} - Status: {status}")

    except UserProfile.DoesNotExist:
        print(f"❌ UserProfile not found for customer {customer_id}")


def handle_subscription_deleted(subscription):
    """Handle subscription cancellation"""
    customer_id = subscription.get('customer')

    try:
        profile = UserProfile.objects.get(stripe_customer_id=customer_id)
        profile.subscription_status = 'canceled'
        profile.subscription_tier = None
        profile.save()
        print(f"✅ Subscription canceled for user {profile.user.username}")

    except UserProfile.DoesNotExist:
        print(f"❌ UserProfile not found for customer {customer_id}")


def handle_payment_succeeded(invoice):
    """Handle successful payment"""
    customer_id = invoice.get('customer')
    subscription_id = invoice.get('subscription')

    try:
        profile = UserProfile.objects.get(stripe_customer_id=customer_id)
        profile.subscription_status = 'active'

        # Update period end from subscription items
        if subscription_id:
            subscription = stripe.Subscription.retrieve(subscription_id)
            try:
                if 'items' in subscription and subscription['items']:
                    items_data = subscription['items'].get('data', [])
                    if items_data and len(items_data) > 0:
                        current_period_end_timestamp = items_data[0].get('current_period_end')
                        if current_period_end_timestamp:
                            profile.subscription_current_period_end = timezone.datetime.fromtimestamp(
                                current_period_end_timestamp, tz=timezone.utc
                            )
            except Exception as e:
                print(f"❌ Error accessing subscription items in payment_succeeded: {str(e)}")

        profile.save()
        print(f"✅ Payment succeeded for user {profile.user.username}")

    except UserProfile.DoesNotExist:
        print(f"❌ UserProfile not found for customer {customer_id}")


def handle_payment_failed(invoice):
    """Handle failed payment"""
    customer_id = invoice.get('customer')

    try:
        profile = UserProfile.objects.get(stripe_customer_id=customer_id)
        profile.subscription_status = 'past_due'
        profile.save()
        print(f"⚠️ Payment failed for user {profile.user.username}")

    except UserProfile.DoesNotExist:
        print(f"❌ UserProfile not found for customer {customer_id}")


@login_required
def cancel_subscription(request):
    """Cancel user's subscription"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST request required'}, status=400)

    try:
        profile = UserProfile.objects.get(user=request.user)

        if not profile.stripe_subscription_id:
            return JsonResponse({'error': 'No active subscription found'}, status=400)

        # Cancel at period end (user keeps access until end of billing period)
        stripe.Subscription.modify(
            profile.stripe_subscription_id,
            cancel_at_period_end=True
        )

        return JsonResponse({
            'success': True,
            'message': 'Subscription will be canceled at the end of the billing period'
        })

    except UserProfile.DoesNotExist:
        return JsonResponse({'error': 'User profile not found'}, status=404)
    except Exception as e:
        print(f"Error canceling subscription: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def get_subscription_status(request):
    """Get current subscription status for the user"""
    try:
        profile = UserProfile.objects.get(user=request.user)

        return JsonResponse({
            'has_subscription': profile.has_active_subscription,
            'tier': profile.subscription_tier,
            'status': profile.subscription_status,
            'current_period_end': profile.subscription_current_period_end.isoformat() if profile.subscription_current_period_end else None,
            'games_analyzed': profile.games_analyzed_this_month,
            'monthly_limit': profile.monthly_game_limit,
            'remaining_analyses': profile.remaining_analyses,
        })

    except UserProfile.DoesNotExist:
        return JsonResponse({
            'has_subscription': False,
            'tier': None,
            'status': None,
            'games_analyzed': 0,
            'monthly_limit': 0,
            'remaining_analyses': 0,
        })
