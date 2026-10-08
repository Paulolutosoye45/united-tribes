import { redirect } from "next/navigation";

/** The front door is the app: signed-in people land on Home, others on sign-in. */
export default function Root() {
  redirect("/home");
}
