export const SESSION_TOKEN_COOKIE_NAME = "bg_session_token";

export interface SessionToken {
  id: string;
  secret: string;
}

export function formatSessionToken(sessionToken: SessionToken) {
  return encodeURIComponent(`${sessionToken.id}.${sessionToken.secret}`);
}

function splitOnce(value: string, separator: string) {
  const index = value.indexOf(separator);
  if (index === -1) {
    return [value];
  }
  return [value.slice(0, index), value.slice(index + separator.length)];
}

export function parseSessionToken(sessionTokenStr: string) {
  const sessionTokenDecoded = decodeURIComponent(sessionTokenStr);
  const sessionTokenParts = splitOnce(sessionTokenDecoded, ".");

  if (sessionTokenParts.length !== 2) {
    return undefined;
  }

  return {
    id: sessionTokenParts[0],
    secret: sessionTokenParts[1],
  };
}
