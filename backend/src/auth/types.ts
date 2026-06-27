export interface AuthIdentity {
  userId: string
  email: string
  displayName: string
  permissions: string[]
  forcePasswordChange: boolean
}

export interface StepUpCredentials {
  password?: string
  totpCode?: string
}

export interface AuthProvider {
  /** Full authentication — returns identity or null on failure */
  authenticate(credentials: { email: string; password: string; totpCode?: string }): Promise<AuthIdentity | null>
  /**
   * Step-up verification for reveal/rotation — true if credentials are valid.
   * lastAuthAt (epoch ms) is passed for Keycloak mode's time-based step-up check.
   */
  stepUp(
    user: { userId: string; email: string; lastAuthAt?: number },
    credentials: StepUpCredentials,
  ): Promise<boolean>
  /** Resolve BI-Ro permission flags for a given userId */
  resolveRoles(userId: string): Promise<string[]>
}
