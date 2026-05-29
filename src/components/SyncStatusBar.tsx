import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useAppContext } from '../store/AppContext';

interface SyncStatusBarProps {
  style?: object;
}

const SyncStatusBar: React.FC<SyncStatusBarProps> = ({ style }) => {
  const { state, triggerSync } = useAppContext();
  const dotAnim = useRef(new Animated.Value(0)).current;

  // Animate dot when online
  useEffect(() => {
    if (state.isOnline) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      dotAnim.stopAnimation();
      dotAnim.setValue(0);
    }
  }, [state.isOnline, dotAnim]);

  const dotOpacity = dotAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const lastSyncLabel = state.lastSyncAt
    ? new Date(state.lastSyncAt).toLocaleTimeString()
    : 'Never';

  return (
    <View style={[styles.bar, style]}>
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: state.isOnline ? '#34C759' : '#FF3B30', opacity: dotOpacity },
        ]}
      />
      <View style={styles.info}>
        <Text style={styles.status}>
          {state.isOnline ? 'Online' : 'Offline'}
        </Text>
        {state.pendingSyncCount > 0 && (
          <Text style={styles.pending}>{state.pendingSyncCount} sessions pending sync</Text>
        )}
        {state.lastSyncAt && (
          <Text style={styles.lastSync}>Last sync: {lastSyncLabel}</Text>
        )}
      </View>
      {state.isOnline && state.pendingSyncCount > 0 && (
        <TouchableOpacity style={styles.syncBtn} onPress={triggerSync}>
          <Text style={styles.syncBtnText}>Sync Now</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  info: {
    flex: 1,
  },
  status: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  pending: {
    color: '#FF9F0A',
    fontSize: 12,
    marginTop: 1,
  },
  lastSync: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 1,
  },
  syncBtn: {
    backgroundColor: '#0A84FF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  syncBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
});

export default SyncStatusBar;
