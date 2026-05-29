import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, Alert, ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, UserRecord, AuthSession } from '../types';
import StorageService from '../services/StorageService';
import SyncStatusBar from '../components/SyncStatusBar';
import { useAppContext } from '../store/AppContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Admin'> };

type Tab = 'USERS' | 'SESSIONS';

const AdminScreen: React.FC<Props> = ({ navigation }) => {
  const { state, dispatch, triggerSync } = useAppContext();
  const [tab, setTab] = useState<Tab>('USERS');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'USERS') {
        setUsers(await StorageService.getAllUsers());
      } else {
        setSessions(await StorageService.getPendingSessions());
      }
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = (user: UserRecord) => {
    Alert.alert(
      'Delete User',
      `Remove ${user.name} from the system? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await StorageService.deleteUser(user.id);
            const count = await StorageService.getEnrolledUserCount();
            dispatch({ type: 'SET_USER_COUNT', payload: count });
            loadData();
          },
        },
      ],
    );
  };

  const handleSync = async () => {
    setLoading(true);
    await triggerSync();
    await loadData();
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Admin Panel</Text>

        <SyncStatusBar style={{ marginBottom: 4 }} />

        {state.isOnline && state.pendingSyncCount > 0 && (
          <TouchableOpacity style={styles.syncBtn} onPress={handleSync}>
            <Text style={styles.syncBtnText}>Sync {state.pendingSyncCount} sessions to AWS</Text>
          </TouchableOpacity>
        )}

        {/* Tab switcher */}
        <View style={styles.tabs}>
          <TabBtn label={`Users (${state.enrolledUserCount})`} active={tab === 'USERS'} onPress={() => setTab('USERS')} />
          <TabBtn label={`Pending (${state.pendingSyncCount})`} active={tab === 'SESSIONS'} onPress={() => setTab('SESSIONS')} />
        </View>

        {loading ? (
          <ActivityIndicator color="#0A84FF" style={{ flex: 1 }} />
        ) : tab === 'USERS' ? (
          <FlatList
            data={users}
            keyExtractor={u => u.id}
            renderItem={({ item }) => (
              <UserRow user={item} onDelete={() => deleteUser(item)} />
            )}
            ListEmptyComponent={<EmptyState label="No enrolled users" />}
            contentContainerStyle={{ paddingBottom: 32 }}
          />
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={s => s.id}
            renderItem={({ item }) => <SessionRow session={item} />}
            ListEmptyComponent={<EmptyState label="No pending sessions" />}
            contentContainerStyle={{ paddingBottom: 32 }}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

interface UserRowProps { user: UserRecord; onDelete: () => void }
const UserRow: React.FC<UserRowProps> = ({ user, onDelete }) => (
  <View style={styles.row}>
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{user.name[0]?.toUpperCase()}</Text>
    </View>
    <View style={styles.rowInfo}>
      <Text style={styles.rowTitle}>{user.name}</Text>
      <Text style={styles.rowSub}>{user.employeeId} · {user.department}</Text>
      <Text style={styles.rowDate}>{new Date(user.enrolledAt).toLocaleDateString()}</Text>
    </View>
    <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}>
      <Text style={styles.deleteText}>Remove</Text>
    </TouchableOpacity>
  </View>
);

interface SessionRowProps { session: AuthSession }
const SessionRow: React.FC<SessionRowProps> = ({ session }) => (
  <View style={styles.row}>
    <View style={[styles.avatar, { backgroundColor: '#1A2F1A' }]}>
      <Text style={styles.avatarText}>📋</Text>
    </View>
    <View style={styles.rowInfo}>
      <Text style={styles.rowTitle}>{new Date(session.timestamp).toLocaleString()}</Text>
      <Text style={styles.rowSub}>
        Recognition: {Math.round(session.recognitionScore * 100)}% ·
        Liveness: {Math.round(session.livenessScore * 100)}%
      </Text>
      <Text style={[styles.rowDate, { color: '#FF9F0A' }]}>Pending sync</Text>
    </View>
  </View>
);

interface TabBtnProps { label: string; active: boolean; onPress: () => void }
const TabBtn: React.FC<TabBtnProps> = ({ label, active, onPress }) => (
  <TouchableOpacity style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const EmptyState = ({ label }: { label: string }) => (
  <View style={styles.empty}><Text style={styles.emptyText}>{label}</Text></View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF' },
  syncBtn: { backgroundColor: '#1C3320', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#30D158' },
  syncBtnText: { color: '#30D158', fontWeight: '600', fontSize: 15 },
  tabs: { flexDirection: 'row', backgroundColor: '#1C1C1E', borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, borderRadius: 9, paddingVertical: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#2C2C2E' },
  tabText: { color: '#8E8E93', fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: '#FFF' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 14, padding: 14, marginBottom: 8, gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontWeight: '700', fontSize: 18 },
  rowInfo: { flex: 1 },
  rowTitle: { color: '#FFF', fontWeight: '600', fontSize: 15 },
  rowSub: { color: '#8E8E93', fontSize: 12, marginTop: 2 },
  rowDate: { color: '#555', fontSize: 11, marginTop: 2 },
  deleteBtn: { backgroundColor: '#2C1010', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  deleteText: { color: '#FF3B30', fontWeight: '600', fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { color: '#555', fontSize: 15 },
});

export default AdminScreen;
