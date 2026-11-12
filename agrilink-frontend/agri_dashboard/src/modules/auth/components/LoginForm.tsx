import { useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LoaderCircle, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthProvider';
import { validateLoginCredentials } from '../lib/validateLoginCredentials';
import { PasswordInput } from './PasswordInput';

const fieldEntrance = {
  hidden: { opacity: 0, y: 9 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: 'easeOut' as const } },
};

const formEntrance = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.14 } },
};

export function LoginForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { login } = useAuth();
  const identityRef = useRef<HTMLInputElement>(null);
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ identity?: string; password?: string }>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const nextErrors = validateLoginCredentials({ identity, password });
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length) {
      if (nextErrors.identity) identityRef.current?.focus();
      else document.getElementById('admin-password')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await login({ identity: identity.trim(), password });
      if (result.status === 'authenticated') {
        onAuthenticated();
      } else if (result.status === 'not-configured') {
        setFeedback('Administrator sign-in is not connected yet.');
      } else if (result.status === 'rejected') {
        setPassword('');
        setFeedback('Unable to sign in with those credentials. Please check your details and try again.');
      } else {
        setFeedback('Unable to sign in with those credentials. Please check your details and try again.');
      }
    } catch {
      setFeedback('Unable to sign in with those credentials. Please check your details and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.form
      id="login-form"
      className="auth-form"
      onSubmit={handleSubmit}
      noValidate
      initial="hidden"
      animate="visible"
      variants={formEntrance}
    >
      <motion.div className="auth-field" variants={fieldEntrance}>
        <label htmlFor="admin-username">Administrator email or username</label>
        <div className={`auth-input-wrap${errors.identity ? ' auth-input-wrap--invalid' : ''}`}>
          <UserRound className="auth-input-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
          <input
            ref={identityRef}
            id="admin-username"
            name="username"
            type="text"
            autoComplete="username"
            inputMode="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Email address or username"
            value={identity}
            onChange={(event) => {
              setIdentity(event.target.value);
              if (errors.identity) setErrors((current) => ({ ...current, identity: undefined }));
            }}
            aria-invalid={Boolean(errors.identity)}
            aria-describedby={errors.identity ? 'admin-username-error' : undefined}
            disabled={submitting}
          />
        </div>
        {errors.identity && <span className="auth-field-error" id="admin-username-error">{errors.identity}</span>}
      </motion.div>

      <motion.div className="auth-field" variants={fieldEntrance}>
        <label htmlFor="admin-password">Password</label>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
          }}
          error={errors.password}
          disabled={submitting}
        />
        {errors.password && <span className="auth-field-error" id="admin-password-error">{errors.password}</span>}
      </motion.div>

      <motion.button
        className="auth-submit"
        type="submit"
        disabled={submitting}
        variants={fieldEntrance}
        whileHover={submitting ? undefined : { y: -1 }}
        whileTap={submitting ? undefined : { scale: 0.99 }}
      >
        {submitting && <LoaderCircle className="auth-submit__spinner" size={17} aria-hidden="true" />}
        <span>{submitting ? 'Authenticating...' : 'Sign In'}</span>
      </motion.button>

      <AnimatePresence initial={false}>
        {feedback && (
          <motion.p
            className="auth-feedback"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            {feedback}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.form>
  );
}
