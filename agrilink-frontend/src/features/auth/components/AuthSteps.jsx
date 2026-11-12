/**
 * Extra auth steps rendered inside AuthModal's card:
 *  - signup email OTP verification (+ resend)
 *  - 3-step password recovery (email → OTP → new password)
 */
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MailCheck,
  KeyRound,
} from "lucide-react";
import Field, { FIELD_ICONS } from "../../../components/ui/Field";
import {
  verifySignup,
  resendSignupOtp,
  forgotPassword,
  resendForgotPasswordOtp,
  verifyResetOtp,
  resetPassword,
} from "../services/authService";

const btn =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-lift transition-all hover:bg-primary-dark active:scale-[0.98] disabled:cursor-wait disabled:bg-primary-light";

function OtpInput({ value, onChange, error }) {
  return (
    <div>
      <label
        htmlFor="auth-otp"
        className="mb-1.5 block text-[13px] font-semibold text-ink-3"
      >
        6 digit code
      </label>
      <input
        id="auth-otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) =>
          onChange(e.target.value.replace(/\D/g, "").slice(0, 6))
        }
        aria-invalid={error ? true : undefined}
        className="h-14 w-full rounded-xl border border-line bg-paper text-center font-mono text-2xl tracking-[0.6em] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-danger-line"
        placeholder="••••••"
      />
    </div>
  );
}

function Msg({ tone = "danger", children }) {
  if (!children) return null;
  const cls =
    tone === "ok"
      ? "bg-primary-light/40 text-brand-deep"
      : "bg-danger-wash/90 text-danger";
  const Icon = tone === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <p
      role="alert"
      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ${cls}`}
    >
      <Icon size={13} aria-hidden="true" className="shrink-0" />
      {children}
    </p>
  );
}

/* ------------------------------------------------- signup verification */
export function SignupOtpStep({ pending, onAuth, onBack }) {
  const [code, setCode] = useState("");
  const [token, setToken] = useState(pending.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!token)
      return setError("Registration session expired. Please sign up again.");
    if (code.length !== 6)
      return setError("Enter the 6 digit code from your email.");
    setBusy(true);
    setError("");
    try {
      const user = await verifySignup({
        token,
        code,
        email: pending.email,
        password: pending.password,
      });
      onAuth(user);
    } catch (err) {
      setError(err?.error || "That code did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!token)
      return setError("Registration session expired. Please sign up again.");
    setError("");
    setInfo("");
    try {
      const d = await resendSignupOtp(token);
      if (d?.token) setToken(d.token);
      setInfo("A new code is on its way to your inbox.");
    } catch (err) {
      setError(err?.error || "Could not resend the code.");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Header icon={MailCheck} title="Check your email" onBack={onBack}>
        We sent a 6 digit code to{" "}
        <strong className="text-ink-3">{pending.email}</strong>.
      </Header>
      <OtpInput value={code} onChange={setCode} error={error} />
      <Msg>{error}</Msg>
      <Msg tone="ok">{info}</Msg>
      <button type="submit" disabled={busy} className={btn}>
        {busy ? (
          <Loader2 size={17} className="animate-spin" aria-hidden="true" />
        ) : null}
        {busy ? "Verifying…" : "Verify & create account"}
      </button>
      <p className="text-center text-[13px] text-muted">
        Didn&apos;t get it?{" "}
        <button
          type="button"
          onClick={resend}
          className="font-semibold text-brand hover:text-brand-deep"
        >
          Resend code
        </button>
      </p>
    </form>
  );
}

/* ----------------------------------------------------- password reset */
export function ForgotPasswordStep({ initialEmail = "", onDone, onBack }) {
  const [stage, setStage] = useState("email"); // email | otp | reset | done
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [token, setToken] = useState(null);
  const [pw, setPw] = useState({ newPassword: "", confirmPassword: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err?.error || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (stage === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return setError("Enter a valid email address.");
      return run(async () => {
        const d = await forgotPassword(email.trim());
        if (!d.token)
          return setError("Could not start the reset. Please try again.");
        setToken(d.token);
        setCode("");
        setInfo("If this address can receive a recovery email, a code may arrive shortly. We do not confirm whether an account uses this address.");
        setResendCooldown(30);
        setStage("otp");
      });
    }
    if (stage === "otp") {
      if (!token)
        return setError("Reset session expired. Please request a new code.");
      if (code.length !== 6)
        return setError("Enter the 6 digit code from your email.");
      return run(async () => {
        const d = await verifyResetOtp(token, code);
        if (!d.token)
          return setError("Could not verify the code. Please try again.");
        setToken(d.token);
        setError("");
        setStage("reset");
      });
    }
    if (stage === "reset") {
      if (!token)
        return setError("Reset session expired. Please request a new code.");
      if (pw.newPassword.length < 10)
        return setError("Use at least 10 characters.");
      if (pw.newPassword !== pw.confirmPassword)
        return setError("Passwords don't match.");
      return run(async () => {
        await resetPassword(token, pw.newPassword, pw.confirmPassword);
        setStage("done");
      });
    }
    onDone(email);
  };

  const resend = async () => {
    if (!token || busy || resendCooldown > 0) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const result = await resendForgotPasswordOtp(token);
      if (result?.token) setToken(result.token);
      setResendCooldown(30);
      setInfo("If the recovery request is eligible and email is available, another code may arrive shortly.");
    } catch (err) {
      setError(err?.error || "The code could not be resent. Please try again later.");
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    email: [
      "Reset your password",
      "Enter your account email and we will send you a code.",
    ],
    otp: ["Enter the code", "If this address can receive a recovery email, a code may arrive shortly."],
    reset: ["Choose a new password", "Use at least 10 characters."],
    done: ["Password updated", "You can now sign in with your new password."],
  };
  const label = {
    email: "Send code",
    otp: "Verify code",
    reset: "Update password",
    done: "Back to sign in",
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Header
        icon={stage === "done" ? CheckCircle2 : KeyRound}
        title={titles[stage][0]}
        onBack={onBack}
      >
        {titles[stage][1]}
      </Header>
      {stage === "email" && (
        <Field
          id="reset-email"
          label="Email address"
          type="email"
          icon={FIELD_ICONS?.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      )}
      {stage === "otp" && (
        <>
          <OtpInput value={code} onChange={setCode} error={error} />
          <p role="status" aria-live="polite" className="text-xs text-muted">If no email arrives, check the address and try again. Recovery requests are handled without confirming whether an account exists.</p>
        </>
      )}
      {stage === "reset" && (
        <>
          <Field
            id="reset-new"
            label="New password"
            type="password"
            icon={FIELD_ICONS?.password}
            value={pw.newPassword}
            onChange={(e) =>
              setPw((p) => ({ ...p, newPassword: e.target.value }))
            }
            autoComplete="new-password"
          />
          <Field
            id="reset-confirm"
            label="Confirm new password"
            type="password"
            icon={FIELD_ICONS?.password}
            value={pw.confirmPassword}
            onChange={(e) =>
              setPw((p) => ({ ...p, confirmPassword: e.target.value }))
            }
            autoComplete="new-password"
          />
        </>
      )}
      <Msg>{error}</Msg>
      {info && <p role="status" aria-live="polite" className="rounded-xl bg-primary-light/40 px-3 py-2 text-xs font-medium text-brand-deep">{info}</p>}
      {stage === "otp" && <button type="button" onClick={resend} disabled={busy || resendCooldown > 0} className="w-full text-center text-xs font-semibold text-brand underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}</button>}
      <button type="submit" disabled={busy} className={btn}>
        {busy ? (
          <Loader2 size={17} className="animate-spin" aria-hidden="true" />
        ) : null}
        {label[stage]}
      </button>
    </form>
  );
}

function Header({ icon: Icon, title, onBack, children }) {
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink-3"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back
      </button>
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary-dark text-white shadow-lift">
        <Icon size={20} aria-hidden="true" />
      </span>
      <h2
        id="auth-title"
        className="font-display text-[21px] font-bold text-ink"
      >
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}
