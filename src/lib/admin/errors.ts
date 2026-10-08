/** Plain-language messages for the codes our database functions raise. */
export function adminErrorMessage(error: { code?: string } | null | undefined): string {
  switch (error?.code) {
    case "42501":
      return "You don't have permission to do that.";
    case "28000":
      return "Your session has ended. Sign in again.";
    case "22023":
      return "Check the email address and the role, then try again.";
    case "23514":
      return "You can't remove the last admin. Make someone else an admin first.";
    case "P0002":
      return "That has already changed. Refresh the page to see the latest.";
    default:
      return "Something went wrong. Try again in a moment.";
  }
}
