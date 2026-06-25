export interface AuthIdentity {
  userId: string
  email: string
  displayName: string
  permissions: string[]
  forcePasswordChange: boolean
}
