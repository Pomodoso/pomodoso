import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';

// Expo's documented boilerplate for openAuthSessionAsync (useAuth.ts's
// signInWithGoogle) — dismisses the auth browser session properly once the
// redirect lands. Safe to call at module scope; a no-op outside a pending
// auth session.
WebBrowser.maybeCompleteAuthSession();

type Mode = 'signin' | 'signup';
type LinkState = 'idle' | 'sending' | 'sent';

// Ports web's Login.tsx (the fuller flow — email/password, magic link,
// forgot password) rather than the extension's OTP-code workaround, which
// exists only because a Chrome popup can't receive a redirect. Mobile can
// (app.json's "pomodoso" scheme + useAuth.ts's deep-link handling), so
// there's no reason to carry that limitation over.
export default function LoginScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [resetState, setResetState] = useState<LinkState>('idle');
  const [magicState, setMagicState] = useState<LinkState>('idle');

  useEffect(() => {
    if (auth.session) router.back();
  }, [auth.session]);

  if (!auth.isConfigured) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.title}>Not configured</Text>
          <Text style={styles.hint}>
            Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local to enable sign in.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  async function handleSubmit(): Promise<void> {
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        await auth.signUp(email.trim(), password);
        setSignupDone(true);
      } else {
        await auth.signIn(email.trim(), password);
        router.back();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn(): Promise<void> {
    setError('');
    setGoogleLoading(true);
    try {
      await auth.signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in with Google');
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleMagicLink(): Promise<void> {
    if (!email.trim()) {
      setError('Enter your email first, then request a magic link');
      return;
    }
    setError('');
    setMagicState('sending');
    try {
      await auth.sendMagicLinkEmail(email.trim());
      setMagicState('sent');
    } catch (err) {
      setMagicState('idle');
      setError(err instanceof Error ? err.message : 'Could not send magic link');
    }
  }

  async function handleForgotPassword(): Promise<void> {
    if (!email.trim()) {
      setError('Enter your email first, then tap "Forgot password?"');
      return;
    }
    setError('');
    setResetState('sending');
    try {
      await auth.resetPassword(email.trim());
      setResetState('sent');
    } catch (err) {
      setResetState('idle');
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    }
  }

  if (signupDone) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.emoji}>✉️</Text>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.hint}>We sent a confirmation link to {email}.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Pomodoso</Text>
        <Text style={styles.subtitle}>{mode === 'signin' ? 'Sign in to your account' : 'Create an account'}</Text>

        <Pressable
          style={[styles.googleBtn, googleLoading && styles.disabled]}
          onPress={() => void handleGoogleSignIn()}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <>
              <Ionicons name="logo-google" size={16} color={colors.text} />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textTertiary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textTertiary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={[styles.submitBtn, loading && styles.disabled]} onPress={() => void handleSubmit()} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.submitBtnText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
          )}
        </Pressable>

        {mode === 'signin' && (
          <Pressable
            onPress={() => void handleForgotPassword()}
            disabled={resetState === 'sending'}
            style={styles.linkRow}
          >
            <Text style={styles.link}>
              {resetState === 'sent'
                ? '✓ Reset link sent — check your email'
                : resetState === 'sending'
                  ? 'Sending reset link…'
                  : 'Forgot password?'}
            </Text>
          </Pressable>
        )}

        {mode === 'signin' && (
          <Pressable onPress={() => void handleMagicLink()} disabled={magicState === 'sending'} style={styles.linkRow}>
            <Text style={styles.link}>
              {magicState === 'sent'
                ? '✉️ Magic link sent — check your email'
                : magicState === 'sending'
                  ? 'Sending magic link…'
                  : 'Email me a magic link instead'}
            </Text>
          </Pressable>
        )}

        <View style={styles.switchModeRow}>
          <Text style={styles.switchModeText}>
            {mode === 'signin' ? "New to Pomodoso? " : 'Already have an account? '}
          </Text>
          <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            <Text style={styles.switchModeLink}>{mode === 'signin' ? 'Create an account' : 'Sign in'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingVertical: 10 },
  back: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emoji: { fontSize: 32, marginBottom: 10 },
  brand: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
  hint: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.text,
    marginBottom: 12,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 16,
  },
  googleBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.text },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 11.5, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  error: { fontSize: 12.5, color: colors.accent, marginBottom: 12 },
  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  disabled: { opacity: 0.6 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  linkRow: { alignItems: 'center', marginTop: 16 },
  link: { fontSize: 12.5, color: colors.textSecondary, textDecorationLine: 'underline' },
  switchModeRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 },
  switchModeText: { fontSize: 13.5, color: colors.textSecondary },
  switchModeLink: { fontSize: 13.5, color: colors.accent, fontWeight: '700' },
});
