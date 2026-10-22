// Empty on web (same origin). Capacitor builds set VITE_API_BASE_URL to the deployed API.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''
