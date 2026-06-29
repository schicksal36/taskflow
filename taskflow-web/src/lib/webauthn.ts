import type {
  BiometricLoginOptions,
  BiometricLoginVerifyInput,
  BiometricRegisterOptions,
  BiometricRegisterVerifyInput,
} from "@/lib/api";

function base64UrlToUint8Array(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function arrayBufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isWebAuthnSupported() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && Boolean(navigator.credentials);
}

export async function createBiometricRegistration(
  options: BiometricRegisterOptions,
  deviceName: string,
): Promise<BiometricRegisterVerifyInput> {
  if (!isWebAuthnSupported()) {
    throw new Error("이 브라우저는 생체인식 로그인을 지원하지 않습니다.");
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64UrlToUint8Array(options.challenge),
      rp: options.rp,
      user: {
        id: new TextEncoder().encode(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation,
      authenticatorSelection: options.authenticatorSelection,
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("생체인식 credential을 만들지 못했습니다.");
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = typeof response.getTransports === "function" ? response.getTransports() : [];

  return {
    challenge: options.challenge,
    credential_id: credential.id,
    public_key: arrayBufferToBase64Url(response.attestationObject),
    sign_count: 0,
    device_name: deviceName,
    transports,
  };
}

export async function createBiometricAssertion(options: BiometricLoginOptions): Promise<BiometricLoginVerifyInput> {
  if (!isWebAuthnSupported()) {
    throw new Error("이 브라우저는 생체인식 로그인을 지원하지 않습니다.");
  }

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: base64UrlToUint8Array(options.challenge),
      timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: options.allowCredentials.map((item) => ({
        ...item,
        id: base64UrlToUint8Array(item.id),
      })),
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("생체인식 credential을 확인하지 못했습니다.");
  }

  return {
    challenge: options.challenge,
    credential_id: credential.id,
    sign_count: 0,
  };
}
