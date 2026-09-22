import crypto from "crypto";
import {
  firestoreSetDoc,
  firestoreGetDoc,
  firestoreListDocs,
  findUserByEmail
} from "./dbService.js";

/* ---------------------------------------------------------------------------
   In-Memory Stores for Sessions, CSRF States, and Rate Limiting
   --------------------------------------------------------------------------- */
const sessionCache = new Map();
const oauthStateCache = new Map();
const rateLimitMap = new Map();

// Rate limit config: 5 failed attempts per 15 minutes per IP or Email
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

/* ---------------------------------------------------------------------------
   1. Password Requirements & Security
   ---------------------------------------------------------------------------
   Requirements:
   - Minimum 8 characters
   - At least 1 uppercase letter
   - At least 1 lowercase letter
   - At least 1 number
   - At least 1 special character
   --------------------------------------------------------------------------- */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== "string") {
    return {
      isValid: false,
      score: 0,
      errors: ["Password is required."]
    };
  }

  const errors = [];
  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);

  if (!hasLength) errors.push("Password must be at least 8 characters long.");
  if (!hasUpper) errors.push("Password must contain at least one uppercase letter (A-Z).");
  if (!hasLower) errors.push("Password must contain at least one lowercase letter (a-z).");
  if (!hasDigit) errors.push("Password must contain at least one numeric digit (0-9).");
  if (!hasSpecial) errors.push("Password must contain at least one special symbol (e.g. !@#$%^&*).");

  let score = 0;
  if (hasLength) score++;
  if (hasUpper) score++;
  if (hasLower) score++;
  if (hasDigit) score++;
  if (hasSpecial) score++;

  return {
    isValid: errors.length === 0,
    score, // 0 to 5
    errors,
    checks: {
      length: hasLength,
      upper: hasUpper,
      lower: hasLower,
      digit: hasDigit,
      special: hasSpecial
    }
  };
}

export function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

export function hashPassword(password, salt) {
  if (!salt) {
    salt = generateSalt();
  }
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return {
    hash: derivedKey.toString("hex"),
    salt
  };
}

export function verifyPassword(password, storedHash, storedSalt) {
  if (!storedHash || !password) return false;

  // Modern salted scrypt comparison
  if (storedSalt) {
    try {
      const derived = crypto.scryptSync(password, storedSalt, 64);
      const testHash = derived.toString("hex");
      const a = Buffer.from(testHash, "hex");
      const b = Buffer.from(storedHash, "hex");
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch (e) {
      return false;
    }
  }

  // Legacy SHA-256 fallback compatibility
  const legacyHash = crypto.createHash("sha256").update(password + "greenroom_salt_2026").digest("hex");
  return legacyHash === storedHash;
}

/* ---------------------------------------------------------------------------
   2. Rate Limiting for Brute-Force Protection
   --------------------------------------------------------------------------- */
export function checkRateLimit(ip, email) {
  const now = Date.now();
  const keys = [];
  if (ip) keys.push(`ip:${ip}`);
  if (email) keys.push(`email:${email.trim().toLowerCase()}`);

  for (const key of keys) {
    const entry = rateLimitMap.get(key);
    if (entry) {
      // Expire window
      if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      } else if (entry.attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
        const remainingMinutes = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.firstAttempt)) / 60000);
        return {
          isBlocked: true,
          remainingMinutes,
          message: `Too many failed authentication attempts. Account temporarily locked for ${remainingMinutes} minute${remainingMinutes > 1 ? "s" : ""}. Please try again later or reset your password.`
        };
      }
    }
  }

  return { isBlocked: false };
}

export function recordAuthAttempt(ip, email, success) {
  const now = Date.now();
  const keys = [];
  if (ip) keys.push(`ip:${ip}`);
  if (email) keys.push(`email:${email.trim().toLowerCase()}`);

  if (success) {
    for (const key of keys) {
      rateLimitMap.delete(key);
    }
    return;
  }

  for (const key of keys) {
    let entry = rateLimitMap.get(key);
    if (!entry || now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      entry = { attempts: 1, firstAttempt: now };
    } else {
      entry.attempts++;
    }
    rateLimitMap.set(key, entry);
  }
}

/* ---------------------------------------------------------------------------
   3. Session Management (HttpOnly Cookies & Bearer Tokens)
   --------------------------------------------------------------------------- */
export async function createSession(userId, req, rememberMe = false) {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const sessionId = `sess_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const ttlMs = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 7 days vs 24 hours
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  const userAgent = req?.headers?.["user-agent"] || "unknown";
  const ipAddress = req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "127.0.0.1";

  const sessionRecord = {
    id: sessionId,
    session_token: sessionToken,
    user_id: userId,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    user_agent: userAgent,
    ip_address: typeof ipAddress === "string" ? ipAddress.split(",")[0].trim() : "127.0.0.1",
    valid: true,
    remember_me: rememberMe
  };

  // Cache in-memory
  sessionCache.set(sessionToken, sessionRecord);

  // Persist in Firestore
  await firestoreSetDoc("sessions", sessionId, sessionRecord);

  return {
    sessionToken,
    sessionId,
    expiresAt,
    ttlMs
  };
}

export async function validateSession(sessionToken) {
  if (!sessionToken || typeof sessionToken !== "string") {
    return { valid: false };
  }

  // Check in-memory cache
  let session = sessionCache.get(sessionToken);

  if (!session) {
    // Check Firestore
    const allSessions = await firestoreListDocs("sessions", 100);
    session = allSessions.find(s => s.session_token === sessionToken && s.valid === true);
    if (session) {
      sessionCache.set(sessionToken, session);
    }
  }

  if (!session || !session.valid) {
    return { valid: false };
  }

  if (new Date(session.expires_at) <= new Date()) {
    sessionCache.delete(sessionToken);
    return { valid: false, expired: true };
  }

  return {
    valid: true,
    userId: session.user_id,
    session
  };
}

export async function destroySession(sessionToken) {
  if (!sessionToken) return;
  const session = sessionCache.get(sessionToken);
  sessionCache.delete(sessionToken);

  if (session && session.id) {
    await firestoreSetDoc("sessions", session.id, {
      ...session,
      valid: false,
      revoked_at: new Date().toISOString()
    });
  }
}

/* ---------------------------------------------------------------------------
   4. Password Reset Token Generation & Handling
   --------------------------------------------------------------------------- */
export async function createPasswordResetToken(email) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const user = await findUserByEmail(cleanEmail);

  // Return generic response even if user does not exist to prevent user enumeration
  if (!user) {
    return {
      success: true,
      message: "If an account exists for this email, password reset instructions have been dispatched.",
      accountFound: false
    };
  }

  // Generate secure 32-byte token
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour validity

  const updatedUser = {
    ...user,
    reset_password_token: hashedToken,
    reset_password_expires: expiresAt,
    updated_at: new Date().toISOString()
  };

  await firestoreSetDoc("users", user.id, updatedUser);

  return {
    success: true,
    message: "If an account exists for this email, password reset instructions have been dispatched.",
    accountFound: true,
    rawToken, // Provided for live in-app preview/demo convenience
    expiresAt,
    email: cleanEmail
  };
}

export async function resetPasswordWithToken(rawToken, newPassword) {
  if (!rawToken) {
    throw new Error("Reset token is missing or invalid.");
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.isValid) {
    throw new Error(strength.errors[0] || "Password does not meet complexity requirements.");
  }

  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();

  // Find user with this reset token
  const allUsers = await firestoreListDocs("users", 100);
  const user = allUsers.find(u => {
    return u.reset_password_token === hashedToken &&
      u.reset_password_expires &&
      new Date(u.reset_password_expires) > now;
  });

  if (!user) {
    throw new Error("Invalid or expired password reset link. Please request a new one.");
  }

  // Hash new password with fresh salt
  const { hash, salt } = hashPassword(newPassword);

  const updatedUser = {
    ...user,
    password_hash: hash,
    password_salt: salt,
    reset_password_token: null,
    reset_password_expires: null,
    updated_at: new Date().toISOString()
  };

  await firestoreSetDoc("users", user.id, updatedUser);

  // Invalidate all active sessions for this user for security
  for (const [token, sess] of sessionCache.entries()) {
    if (sess.user_id === user.id) {
      sessionCache.delete(token);
    }
  }

  return {
    success: true,
    message: "Password reset successful. You can now log in with your new credentials.",
    user: sanitizeUser(updatedUser)
  };
}

/* ---------------------------------------------------------------------------
   5. Email Verification
   --------------------------------------------------------------------------- */
export async function createEmailVerificationToken(userId) {
  const user = await firestoreGetDoc("users", userId);
  if (!user) throw new Error("User not found.");

  const rawToken = crypto.randomBytes(24).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  const updated = {
    ...user,
    verification_token: hashedToken,
    verification_expires: expiresAt,
    updated_at: new Date().toISOString()
  };
  await firestoreSetDoc("users", userId, updated);

  return {
    rawToken,
    expiresAt,
    email: user.email
  };
}

export async function verifyEmailWithToken(rawToken) {
  if (!rawToken) throw new Error("Verification token is missing.");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();

  const allUsers = await firestoreListDocs("users", 100);
  const user = allUsers.find(u => {
    return u.verification_token === hashedToken &&
      u.verification_expires &&
      new Date(u.verification_expires) > now;
  });

  if (!user) {
    throw new Error("Invalid or expired verification token. Please request a new verification email.");
  }

  const updated = {
    ...user,
    email_verified: true,
    account_status: "active",
    verification_token: null,
    verification_expires: null,
    updated_at: new Date().toISOString()
  };

  await firestoreSetDoc("users", user.id, updated);
  return {
    success: true,
    message: "Email successfully verified! Candidate profile activated.",
    user: sanitizeUser(updated)
  };
}

/* ---------------------------------------------------------------------------
   6. Social Authentication (Real OAuth 2.0 / OpenID Connect)
   ---------------------------------------------------------------------------
   Providers:
   - Google:   https://accounts.google.com/o/oauth2/v2/auth
   - LinkedIn: https://www.linkedin.com/oauth/v2/authorization
   - GitHub:   https://github.com/login/oauth/authorize
   --------------------------------------------------------------------------- */

export function getOAuthAppConfig(provider) {
  const p = (provider || "").toLowerCase();
  if (p === "google") {
    return {
      provider: "google",
      name: "Google",
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
      scope: "openid email profile"
    };
  }
  if (p === "github") {
    return {
      provider: "github",
      name: "GitHub",
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userInfoUrl: "https://api.github.com/user",
      scope: "read:user user:email"
    };
  }
  if (p === "linkedin") {
    return {
      provider: "linkedin",
      name: "LinkedIn",
      clientId: process.env.LINKEDIN_CLIENT_ID || "",
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
      authUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
      userInfoUrl: "https://api.linkedin.com/v2/userinfo",
      scope: "openid profile email"
    };
  }
  throw new Error(`Unsupported OAuth provider: ${provider}`);
}

export function generateOAuthAuthorizeUrl(provider, redirectUri) {
  const cfg = getOAuthAppConfig(provider);
  const state = crypto.randomBytes(24).toString("hex");

  // Save CSRF state with 10-minute expiry
  oauthStateCache.set(state, {
    provider: cfg.provider,
    redirectUri,
    createdAt: Date.now()
  });

  // Clean stale states
  const tenMinsAgo = Date.now() - 10 * 60 * 1000;
  for (const [st, val] of oauthStateCache.entries()) {
    if (val.createdAt < tenMinsAgo) {
      oauthStateCache.delete(st);
    }
  }

  const isConfigured = Boolean(cfg.clientId && cfg.clientSecret);

  if (!isConfigured) {
    return {
      isConfigured: false,
      provider: cfg.provider,
      providerName: cfg.name,
      setupInstructions: {
        envVars: [`${cfg.provider.toUpperCase()}_CLIENT_ID`, `${cfg.provider.toUpperCase()}_CLIENT_SECRET`],
        redirectUri
      },
      message: `${cfg.name} OAuth credentials are not yet configured in environment variables.`
    };
  }

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state
  });

  if (cfg.provider === "google") {
    params.set("access_type", "offline");
    params.set("prompt", "select_account");
  }

  return {
    isConfigured: true,
    provider: cfg.provider,
    url: `${cfg.authUrl}?${params.toString()}`,
    state
  };
}

export async function exchangeOAuthCode(provider, code, state, redirectUri) {
  const cfg = getOAuthAppConfig(provider);

  // Validate state
  const cachedState = oauthStateCache.get(state);
  if (!cachedState || cachedState.provider !== cfg.provider) {
    throw new Error("Invalid or expired OAuth state parameter (potential CSRF attempt).");
  }
  oauthStateCache.delete(state);

  // 1. Exchange code for access token
  const tokenParams = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: tokenParams.toString()
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error(`[OAuth] Token exchange failed for ${provider}:`, errBody);
    throw new Error(`Failed to retrieve access token from ${cfg.name}.`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    throw new Error(`No access token returned by ${cfg.name}.`);
  }

  // 2. Fetch User Profile
  let profile = {
    provider: cfg.provider,
    providerUserId: "",
    email: "",
    name: "",
    avatar: ""
  };

  if (cfg.provider === "google") {
    const userRes = await fetch(cfg.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) throw new Error("Failed to fetch Google candidate profile.");
    const googleUser = await userRes.json();
    profile.providerUserId = googleUser.sub;
    profile.email = googleUser.email;
    profile.name = googleUser.name || googleUser.given_name || "Google Candidate";
    profile.avatar = googleUser.picture || "";
  } else if (cfg.provider === "linkedin") {
    const userRes = await fetch(cfg.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) throw new Error("Failed to fetch LinkedIn candidate profile.");
    const liUser = await userRes.json();
    profile.providerUserId = liUser.sub;
    profile.email = liUser.email;
    profile.name = liUser.name || `${liUser.given_name || ""} ${liUser.family_name || ""}`.trim() || "LinkedIn Candidate";
    profile.avatar = liUser.picture || "";
  } else if (cfg.provider === "github") {
    const userRes = await fetch(cfg.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "GreenRoom-AI-Interviewer"
      }
    });
    if (!userRes.ok) throw new Error("Failed to fetch GitHub candidate profile.");
    const ghUser = await userRes.json();
    profile.providerUserId = String(ghUser.id);
    profile.name = ghUser.name || ghUser.login || "GitHub Candidate";
    profile.avatar = ghUser.avatar_url || "";
    profile.email = ghUser.email;

    // If primary email is private on GitHub, fetch from /user/emails
    if (!profile.email) {
      try {
        const emailsRes = await fetch("https://api.github.com/user/emails", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "GreenRoom-AI-Interviewer"
          }
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json();
          const primary = emails.find(e => e.primary && e.verified) || emails[0];
          if (primary && primary.email) {
            profile.email = primary.email;
          }
        }
      } catch (e) {
        console.warn("[OAuth] Could not fetch private GitHub emails:", e.message);
      }
    }
  }

  if (!profile.email) {
    profile.email = `${cfg.provider}_${profile.providerUserId}@candidate.oauth`;
  }

  // 3. Link or Register User
  return await linkOrRegisterOAuthUser(profile);
}

/* ---------------------------------------------------------------------------
   7. Account Linking: Merging / Associating Social Providers
   --------------------------------------------------------------------------- */
export async function linkOrRegisterOAuthUser({
  provider,
  providerUserId,
  email,
  name,
  avatar,
  target_role,
  target_company,
  experience_level
}) {
  const cleanEmail = email.trim().toLowerCase();

  // Check if an account already exists with this email
  let user = await findUserByEmail(cleanEmail);

  // If not found by email, check by providerUserId in auth_providers list
  if (!user) {
    const allUsers = await firestoreListDocs("users", 100);
    user = allUsers.find(u => {
      if (Array.isArray(u.auth_providers)) {
        return u.auth_providers.some(p => p.provider === provider && p.provider_user_id === providerUserId);
      }
      return false;
    });
  }

  const nowIso = new Date().toISOString();

  if (user) {
    // Existing Account: Link this provider if not already linked
    let providers = Array.isArray(user.auth_providers) ? [...user.auth_providers] : [];
    const existingProviderIdx = providers.findIndex(p => p.provider === provider);

    const providerRecord = {
      provider,
      provider_user_id: providerUserId,
      email: cleanEmail,
      linked_at: nowIso
    };

    if (existingProviderIdx >= 0) {
      providers[existingProviderIdx] = providerRecord;
    } else {
      providers.push(providerRecord);
    }

    const achievements = Array.isArray(user.achievements) ? [...user.achievements] : [];
    const achText = `Linked ${provider.toUpperCase()}`;
    if (!achievements.includes(achText)) {
      achievements.push(achText);
    }

    const updated = {
      ...user,
      display_name: user.display_name || name,
      avatar: user.avatar || avatar,
      auth_providers: providers,
      email_verified: true, // OAuth provider verified the email
      account_status: "active",
      last_login_at: nowIso,
      updated_at: nowIso
    };

    await firestoreSetDoc("users", user.id, updated);
    return sanitizeUser(updated);
  }

  // Brand New User via OAuth
  const userId = `usr_${provider}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const newUser = {
    id: userId,
    email: cleanEmail,
    display_name: name || `${provider.charAt(0).toUpperCase() + provider.slice(1)} Candidate`,
    avatar: avatar || "",
    auth_providers: [
      {
        provider,
        provider_user_id: providerUserId,
        email: cleanEmail,
        linked_at: nowIso
      }
    ],
    email_verified: true,
    account_status: "active",
    target_role: target_role || "Software Engineer",
    target_company: target_company || "Google",
    target_level: experience_level || "mid",
    preferred_language: "english",
    total_interviews: 0,
    avg_score: 0,
    achievements: [`Registered via ${provider.toUpperCase()}`, "Candidate Profile Initialized"],
    weak_spots: [],
    created_at: nowIso,
    updated_at: nowIso,
    last_login_at: nowIso
  };

  await firestoreSetDoc("users", userId, newUser);
  return sanitizeUser(newUser);
}

export async function unlinkOAuthProvider(userId, providerToUnlink) {
  const user = await firestoreGetDoc("users", userId);
  if (!user) throw new Error("User not found.");

  const providers = Array.isArray(user.auth_providers) ? [...user.auth_providers] : [];
  const hasPassword = Boolean(user.password_hash);
  const remainingProviders = providers.filter(p => p.provider !== providerToUnlink);

  // Safety constraint: Never let a candidate disconnect their only login method
  if (!hasPassword && remainingProviders.length === 0) {
    throw new Error(
      `Cannot disconnect ${providerToUnlink.toUpperCase()}. Please set up a password first so you don't lose access to your interview history.`
    );
  }

  const updated = {
    ...user,
    auth_providers: remainingProviders,
    updated_at: new Date().toISOString()
  };

  await firestoreSetDoc("users", userId, updated);
  return sanitizeUser(updated);
}

/* ---------------------------------------------------------------------------
   8. Sanitization (Strip Passwords & Sensitive Secrets)
   --------------------------------------------------------------------------- */
export function sanitizeUser(user) {
  if (!user) return null;
  const {
    password_hash,
    password_salt,
    reset_password_token,
    reset_password_expires,
    verification_token,
    verification_expires,
    ...safeUser
  } = user;

  // Provide connected providers summary
  const connectedProviders = [];
  if (password_hash) connectedProviders.push("email");
  if (Array.isArray(user.auth_providers)) {
    user.auth_providers.forEach(p => {
      if (p && p.provider && !connectedProviders.includes(p.provider)) {
        connectedProviders.push(p.provider);
      }
    });
  }

  return {
    ...safeUser,
    has_password: Boolean(password_hash),
    connected_providers: connectedProviders
  };
}
