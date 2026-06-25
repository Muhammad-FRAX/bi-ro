import { config } from 'dotenv'
// Loads backend/.env so integration tests can reach the dev database.
// dotenv.config() with no args reads from process.cwd(), which is backend/
// when vitest is invoked via `npm test` from the backend directory.
config()
