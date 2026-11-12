import "server-only";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPasswordPilot(userId: string): boolean {
  const selected = process.env.RVW_PASSWORD_PILOT_USER_ID;
  return Boolean(selected && uuid.test(userId) && selected === userId);
}
