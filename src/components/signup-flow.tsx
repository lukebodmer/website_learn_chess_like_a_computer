import React, { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout
} from '@stripe/react-stripe-js'

interface SignupData {
  username: string
  email: string
  password1: string
  password2: string
}

interface Plan {
  tier: 'standard' | 'max'
  name: string
  price: number
  features: string[]
  featured?: boolean
}

const plans: Plan[] = [
  {
    tier: 'standard',
    name: 'Standard',
    price: 3,
    features: [
      '300 game analyses per month',
      'Full analysis reports',
      'Opening statistics',
      'Accuracy tracking',
      'Custom puzzles'
    ]
  },
  {
    tier: 'max',
    name: 'Max',
    price: 9,
    features: [
      '1000 game analyses per month',
      'Full analysis reports',
      'Opening statistics',
      'Accuracy tracking',
      'Custom puzzles',
      'Priority support'
    ],
    featured: true
  }
]

const SignupFlow: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1)
  const [signupData, setSignupData] = useState<SignupData>({
    username: '',
    email: '',
    password1: '',
    password2: ''
  })
  const [selectedTier, setSelectedTier] = useState<'standard' | 'max' | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripePromise, setStripePromise] = useState<Promise<any> | null>(null)
  const [loading, setLoading] = useState(false)

  // Load Stripe on mount
  useEffect(() => {
    const fetchStripeConfig = async () => {
      try {
        const response = await fetch('/api/stripe/config/')
        const { publishable_key } = await response.json()
        setStripePromise(loadStripe(publishable_key))
      } catch (err) {
        console.error('Failed to load Stripe config:', err)
      }
    }
    fetchStripeConfig()
  }, [])

  // Check for return from checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')

    if (sessionId) {
      handleCheckoutReturn(sessionId)
    }
  }, [])

  const handleCheckoutReturn = async (sessionId: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/stripe/complete-signup/?session_id=${sessionId}`)
      const data = await response.json()

      if (response.ok && data.success) {
        // Redirect to home
        window.location.href = data.redirect || '/'
      } else {
        setErrors({ general: data.error || 'Failed to complete signup' })
        setCurrentStep(1)
      }
    } catch (err: any) {
      console.error('Error completing signup:', err)
      setErrors({ general: 'Failed to complete signup. Please contact support.' })
      setCurrentStep(1)
    } finally {
      setLoading(false)
    }
  }

  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!signupData.username || signupData.username.length < 3) {
      newErrors.username = 'Username must be at least 3 characters'
    }

    if (!signupData.email || !signupData.email.includes('@')) {
      newErrors.email = 'Please enter a valid email'
    }

    if (!signupData.password1 || signupData.password1.length < 8) {
      newErrors.password1 = 'Password must be at least 8 characters'
    }

    if (signupData.password1 !== signupData.password2) {
      newErrors.password2 = 'Passwords do not match'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const goToStep = async (step: number) => {
    if (step === 2 && !validateStep1()) {
      return
    }

    if (step === 3) {
      if (!selectedTier) {
        alert('Please select a plan')
        return
      }
      await createCheckoutSession()
    }

    setCurrentStep(step)
  }

  const createCheckoutSession = async () => {
    setLoading(true)
    setErrors({})

    try {
      const response = await fetch('/api/stripe/create-signup-checkout-session/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({
          ...signupData,
          tier: selectedTier
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      setClientSecret(data.clientSecret)
    } catch (err: any) {
      console.error('Error creating checkout session:', err)
      setErrors({ general: err.message })
      setCurrentStep(2) // Go back to plan selection
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setSignupData(prev => ({ ...prev, [name]: value }))
    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const handlePlanSelect = (tier: 'standard' | 'max') => {
    setSelectedTier(tier)
  }

  if (loading) {
    return (
      <div className="signup-container">
        <div className="checkout-loading">
          <div className="spinner-large"></div>
          <p>Processing...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="signup-container">
      <div className="signup-header">
        <h1>Create Your Account</h1>
        <p>Join thousands of chess players improving their game with AI-powered analysis</p>
      </div>

      <div className="signup-content">
        {/* Step Indicator */}
        <div className="step-indicator">
          <div className={`step ${currentStep >= 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}>
            <div className="step-number">1</div>
            <div className="step-label">Account</div>
          </div>
          <div className="step-divider"></div>
          <div className={`step ${currentStep >= 2 ? 'active' : ''} ${currentStep > 2 ? 'completed' : ''}`}>
            <div className="step-number">2</div>
            <div className="step-label">Plan</div>
          </div>
          <div className="step-divider"></div>
          <div className={`step ${currentStep === 3 ? 'active' : ''}`}>
            <div className="step-number">3</div>
            <div className="step-label">Payment</div>
          </div>
        </div>

        {/* Error Messages */}
        {errors.general && (
          <div className="error-banner">
            {errors.general}
          </div>
        )}

        {/* Step 1: Account Creation */}
        {currentStep === 1 && (
          <div className="signup-step">
            <h2>Create Your Account</h2>
            <form className="signup-form" onSubmit={(e) => { e.preventDefault(); goToStep(2); }}>
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={signupData.username}
                  onChange={handleInputChange}
                  required
                />
                {errors.username && <div className="field-error">{errors.username}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={signupData.email}
                  onChange={handleInputChange}
                  required
                />
                {errors.email && <div className="field-error">{errors.email}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="password1">Password</label>
                <input
                  type="password"
                  id="password1"
                  name="password1"
                  value={signupData.password1}
                  onChange={handleInputChange}
                  required
                />
                <div className="field-help">At least 8 characters</div>
                {errors.password1 && <div className="field-error">{errors.password1}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="password2">Confirm Password</label>
                <input
                  type="password"
                  id="password2"
                  name="password2"
                  value={signupData.password2}
                  onChange={handleInputChange}
                  required
                />
                {errors.password2 && <div className="field-error">{errors.password2}</div>}
              </div>

              <button type="submit" className="btn btn-primary btn-large">
                Continue to Plan Selection
              </button>
            </form>

            <div className="signup-footer">
              Already have an account? <a href="/auth/login/">Login here</a>
            </div>
          </div>
        )}

        {/* Step 2: Plan Selection */}
        {currentStep === 2 && (
          <div className="signup-step">
            <h2>Choose Your Plan</h2>
            <p className="step-subtitle">Select the plan that fits your needs</p>

            <div className="plans-grid-signup">
              {plans.map((plan) => (
                <div
                  key={plan.tier}
                  className={`plan-card-signup ${plan.featured ? 'featured' : ''} ${selectedTier === plan.tier ? 'selected' : ''}`}
                  onClick={() => handlePlanSelect(plan.tier)}
                >
                  {plan.featured && <div className="plan-badge">Most Popular</div>}
                  <div className="plan-header">
                    <h3>{plan.name}</h3>
                    <div className="plan-price">${plan.price}<span>/month</span></div>
                  </div>
                  <ul className="plan-features">
                    {plan.features.map((feature, index) => (
                      <li key={index}>
                        {feature.includes('1000') ? <strong>{feature}</strong> : feature}
                      </li>
                    ))}
                  </ul>
                  <div className="plan-select-indicator">
                    <span className="checkmark">✓</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="signup-nav-buttons">
              <button type="button" className="btn btn-secondary" onClick={() => goToStep(1)}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary btn-large"
                disabled={!selectedTier}
                onClick={() => goToStep(3)}
              >
                Continue to Payment
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Payment */}
        {currentStep === 3 && stripePromise && clientSecret && (
          <div className="signup-step">
            <h2>Complete Your Subscription</h2>
            <p className="step-subtitle">
              You've selected the {selectedTier === 'standard' ? 'Standard Plan - $3/month' : 'Max Plan - $9/month'}
            </p>

            <div className="stripe-checkout-embedded">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{ clientSecret }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>

            <div className="signup-nav-buttons">
              <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(2)}>
                Back to Plans
              </button>
            </div>
          </div>
        )}
      </div>
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

export default SignupFlow
