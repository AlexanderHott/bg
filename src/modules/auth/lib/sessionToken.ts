export interface SessionToken {
  id: string;
  secret: string;
}

export function formatSessionToken(sessionToken: SessionToken) {
  return encodeURIComponent(`${sessionToken.id}.${sessionToken.secret}`);
}

export function parseSessionToken(sessionTokenStr: string) {
  const sessionTokenDecoded = decodeURIComponent(sessionTokenStr);
  const sessionTokenParts = sessionTokenDecoded.split(".", 2);
  
  if (sessionTokenParts.length !== 2) {
    return undefined;
  }

  return {
    id: sessionTokenParts[0],
    secret: sessionTokenParts[1],
  };
}
