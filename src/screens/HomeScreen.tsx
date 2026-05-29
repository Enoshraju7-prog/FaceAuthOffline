import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import SyncStatusBar from '../components/SyncStatusBar';
import { useAppContext } from '../store/AppContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const { state } = useAppContext();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appName}>FaceAuth</Text>
          <Text style={styles.subtitle}>Secure • Offline • Lightweight</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatCard label="Enrolled Users" value={state.enrolledUserCount.toString()} />
          <StatCard label="Pending Sync" value={state.pendingSyncCount.toString()} highlight={state.pendingSyncCount > 0} />
        </View>

        {/* Main actions */}
        <View style={styles.actions}>
          <ActionButton
            label="Mark Attendance"
            description="Authenticate using your face"
            icon="🔍"
            color="#0A84FF"
            onPress={() => navigation.navigate('Auth')}
          />
          <ActionButton
            label="Enrol New User"
            description="Register a face for recognition"
            icon="👤"
            color="#30D158"
            onPress={() => navigation.navigate('Enroll')}
          />
          <ActionButton
            label="Admin Panel"
            description="Manage users & sync data"
            icon="⚙️"
            color="#FF9F0A"
            onPress={() => navigation.navigate('Admin')}
          />
        </View>

        {/* Sync status */}
        <SyncStatusBar style={styles.syncBar} />
      </View>
    </SafeAreaView>
  );
};

interface StatCardProps { label: string; value: string; highlight?: boolean }
const StatCard: React.FC<StatCardProps> = ({ label, value, highlight }) => (
  <View style={[styles.statCard, highlight && styles.statCardHighlight]}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

interface ActionButtonProps {
  label: string;
  description: string;
  icon: string;
  color: string;
  onPress: () => void;
}
const ActionButton: React.FC<ActionButtonProps> = ({ label, description, icon, color, onPress }) => (
  <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.8}>
    <View style={[styles.iconCircle, { backgroundColor: color + '22' }]}>
      <Text style={styles.actionIcon}>{icon}</Text>
    </View>
    <View style={styles.actionText}>
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.actionDesc}>{description}</Text>
    </View>
    <Text style={styles.chevron}>›</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, padding: 20, gap: 20 },
  header: { alignItems: 'center', paddingVertical: 24 },
  appName: { fontSize: 34, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
  subtitle: { color: '#8E8E93', fontSize: 14, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1, backgroundColor: '#1C1C1E', borderRadius: 14,
    padding: 16, alignItems: 'center',
  },
  statCardHighlight: { borderWidth: 1, borderColor: '#FF9F0A' },
  statValue: { fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  statLabel: { fontSize: 12, color: '#8E8E93', marginTop: 4, textAlign: 'center' },
  actions: { gap: 12 },
  actionBtn: {
    backgroundColor: '#1C1C1E', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionIcon: { fontSize: 22 },
  actionText: { flex: 1 },
  actionLabel: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  actionDesc: { color: '#8E8E93', fontSize: 13, marginTop: 2 },
  chevron: { color: '#48484A', fontSize: 22, fontWeight: '300' },
  syncBar: { marginTop: 'auto' },
});

export default HomeScreen;
