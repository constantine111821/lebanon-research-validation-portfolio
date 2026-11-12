import "server-only";

// Portfolio sessions use disposable fixture identities.
export function administrationEnabled() {
  return false;
}

export const designatedOwner: (id: string) => boolean = () => false;
