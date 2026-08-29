import { err, ok, tryAsync, trySync, type Result } from "@/lib/result";

function isRegistrationResponseJSON(
  credential: RegistrationResponseJSON | AuthenticationResponseJSON,
): credential is RegistrationResponseJSON {
  return "attestationObject" in credential.response;
}

type RegisterPasskeyError =
  | {
      kind: "INVALID_OPTIONS";
      cause: unknown;
    }
  | {
      kind: "CREATE_CREDENTIALS_FAILURE";
      cause: unknown;
    }
  | {
      kind: "NOT_PUBLIC_KEY";
    }
  | {
      kind: "INVALID_CREDENTIAL_JSON";
    };

export async function registerPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
  signal?: AbortSignal,
): Promise<Result<RegistrationResponseJSON, RegisterPasskeyError>> {
  const optionsParsedResult = trySync(() =>
    PublicKeyCredential.parseCreationOptionsFromJSON(options),
  );
  if (!optionsParsedResult.ok) {
    return err({ kind: "INVALID_OPTIONS", cause: optionsParsedResult.error });
  }

  const credentialResult = await tryAsync(() =>
    navigator.credentials.create({ publicKey: optionsParsedResult.value, signal }),
  );
  if (!credentialResult.ok) {
    return err({ kind: "CREATE_CREDENTIALS_FAILURE", cause: credentialResult.error });
  }
  const credential = credentialResult.value;
  if (!(credential instanceof PublicKeyCredential)) {
    return err({ kind: "NOT_PUBLIC_KEY" });
  }

  const credentialJson = credential.toJSON();

  if (!isRegistrationResponseJSON(credentialJson)) {
    return err({ kind: "INVALID_CREDENTIAL_JSON" });
  }

  return ok(credentialJson);
}

function isAuthenticationResponseJSON(
  credential: RegistrationResponseJSON | AuthenticationResponseJSON,
): credential is AuthenticationResponseJSON {
  return "signature" in credential.response;
}

type AuthenticateWithPasskeyError =
  | {
      kind: "INVALID_OPTIONS";
      cause: unknown;
    }
  | {
      kind: "CREDENTIALS_GET_FAILURE";
      cause: unknown;
    }
  | { kind: "NOT_PUBLIC_KEY" }
  | { kind: "INVALID_CREDENTIAL_JSON" };

export async function authenticateWithPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  signal?: AbortSignal,
): Promise<Result<AuthenticationResponseJSON, AuthenticateWithPasskeyError>> {
  const optionsParsedResult = trySync(() =>
    PublicKeyCredential.parseRequestOptionsFromJSON(options),
  );
  if (!optionsParsedResult.ok) {
    return err({ kind: "INVALID_OPTIONS", cause: optionsParsedResult.error });
  }

  const credentialResult = await tryAsync(() =>
    navigator.credentials.get({
      publicKey: optionsParsedResult.value,
      signal,
    }),
  );
  if (!credentialResult.ok) {
    return err({ kind: "CREDENTIALS_GET_FAILURE", cause: credentialResult.error });
  }
  const credential = credentialResult.value;

  if (!(credential instanceof PublicKeyCredential)) {
    return err({ kind: "NOT_PUBLIC_KEY" });
  }

  const json = credential.toJSON();

  if (!isAuthenticationResponseJSON(json)) {
    return err({ kind: "INVALID_CREDENTIAL_JSON" });
  }

  return ok(json);
}
