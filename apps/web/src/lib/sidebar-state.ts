import { config } from "@automend/shared";

const { cookieName } = config.webClient.sidebar;

/**
 * Whether the sidebar was left open, from the cookie the sidebar itself writes.
 *
 * Open is the default for a first visit and for an unreadable cookie: a collapsed rail is the harder
 * state to make sense of if you have never seen the expanded one.
 */
export function readSidebarOpen(): boolean {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${cookieName}=`));

  return match?.slice(cookieName.length + 1) !== "false";
}
