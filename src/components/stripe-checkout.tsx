import React, { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout
} from '@stripe/react-stripe-js'

interface StripeCheckoutProps {
  tier: 'standard' | 'max'
  onBack: () => void
}

const StripeCheckout: React.FC<StripeCheckoutProps> = ({ tier, onBack }) => {
  const [stripePromise, setStripePromise] = useState<Promise<any> | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load Stripe publishable key
  useEffect(() => {
    const fetchStripeConfig = async () => {
      try {
        const response = await fetch('/api/stripe/config/')
        const { publishable_key } = await response.json()
        setStripePromise(loadStripe(publishable_key))
      } catch (err) {
        console.error('Failed to load Stripe config:', err)
        setError('Failed to initialize payment system')
      }
    }

    fetchStripeConfig()
  }, [])

  // Fetch client secret when tier is selected
  useEffect(() => {
    if (!tier) return

    const fetchClientSecret = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/stripe/create-checkout-session/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
          },
          body: JSON.stringify({ tier })
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create checkout session')
        }

        setClientSecret(data.clientSecret)
      } catch (err: any) {
        console.error('Error creating checkout session:', err)
        setError(err.message || 'Failed to create checkout session')
      } finally {
        setLoading(false)
      }
    }

    fetchClientSecret()
  }, [tier])

  if (error) {
    return (
      <div className="checkout-error">
        <h3>Payment Error</h3>
        <p>{error}</p>
        <button onClick={onBack} className="btn btn-secondary">
          Back to Plans
        </button>
      </div>
    )
  }

  if (loading || !stripePromise || !clientSecret) {
    return (
      <div className="checkout-loading">
        <div className="spinner-large"></div>
        <p>Loading checkout...</p>
      </div>
    )
  }

  return (
    <div className="stripe-checkout-container">
      <div className="checkout-header">
        <h3>Complete Your Subscription</h3>
        <button onClick={onBack} className="btn btn-secondary btn-back">
          ← Back to Plans
        </button>
      </div>

      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}

// Helper function to get CSRF token
function getCookie(name: string): string {
  let cookieValue = ''
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';')
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim()
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1))
        break
      }
    }
  }
  return cookieValue
}

export default StripeCheckout
