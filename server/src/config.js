function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see server/.env.example)`);
  return value;
}

export function loadConfig() {
  const jwtSecret = required('JWT_SECRET');
  if (process.env.NODE_ENV === 'production' && (jwtSecret === 'change-me' || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be a long random string in production');
  }
  return {
    databaseUrl: required('DATABASE_URL'),
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    port: Number(process.env.PORT) || 4000,
    inviteTtlDays: 7,
  };
}
