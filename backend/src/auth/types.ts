export interface AuthIdentity {
  userId: string
  email: string
  displayName: string
  permissions: string[]
  forcePasswordChange: boolean
}

export interface AuthProvider {
  /** Full authentication — returns identity or null on failure */
  authenticate(credentials: { email: string; password: string }): Promise<AuthIdentity | null>
  /** Step-up verification for reveal/rotation — true if credentials are valid */
  stepUp(user: { userId: string; email: string }, credentials: { password?: string }): Promise<boolean>
  /** Resolve BI-Ro permission flags for a given userId */
  resolveRoles(userId: string): Promise<string[]>
}
