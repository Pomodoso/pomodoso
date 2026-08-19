import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';

// Landing screen for a Supabase password-recovery deep link — useAuth's
// applySessionFromUrl already called setSession by the time it navigates
// here (type=recovery), so `session` is expected to be populated almost
// immediately. Mirrors web's ResetPassword.tsx.
export default function ResetPasswordScreen() {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(): Promise<void> {
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setLoading(true);
    try {
      await auth.updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setLoading(false);
    }
  }

  if (auth.loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.hint}>Checking your reset link…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.emoji}>✓</Text>
          <Text style={styles.title}>Password updated</Text>
          <Text style={styles.hint}>You can now sign in with your new password — here and on the web.</Text>
          <Pressable style={styles.submitBtn} onPress={() => router.replace('/')}>
            <Text style={styles.submitBtnText}>Continue</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!auth.session) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.title}>Link expired or invalid</Text>
          <Text style={styles.hint}>
            Password reset links can only be used once and expire after a while. Request a new one from Settings →
            Account.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.centered}>
        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.hint}>Choose a new password for your Pomodoso account.</Text>

        <TextInput
          style={styles.input}
          placeholder="New password"
          placeholderTextColor={colors.textTertiary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
        />
        <TextInput
          style={styles.input}
          placeholder="Repeat new password"
          placeholderTextColor={colors.textTertiary}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.submitBtn, (loading || !password || !confirm) && styles.disabled]}
          onPress={() => void handleSubmit()}
          disabled={loading || !password || !confirm}
        >
          {loading ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.submitBtnText}>Update password</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emoji: { fontSize: 32, marginBottom: 10, color: colors.accent },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
  hint: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  input: {
    width: '100%',
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
  error: { fontSize: 12.5, color: colors.accent, marginBottom: 12, textAlign: 'center' },
  submitBtn: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  disabled: { opacity: 0.6 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: colors.surface },
});
