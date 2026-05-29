import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Vibration } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { v4 as uuidv4 } from 'uuid';
import { RootStackParamList, FaceDetection, LivenessState, LivenessChallenge, FaceEmbedding } from '../types';
import FaceCamera from '../components/FaceCamera';
import LivenessOverlay from '../components/LivenessOverlay';
import LivenessService from '../services/LivenessService';
import FaceRecognitionService from '../services/FaceRecognitionService';
import StorageService from '../services/StorageService';
import DeviceInfoService from '../services/DeviceInfoService';
import { useAppContext } from '../store/AppContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Auth'> };

type Phase = 'LIVENESS' | 'RECOGNISE' | 'SUCCESS' | 'FAIL';

const AUTH_TIMEOUT_MS = 20_000;

const AuthScreen: React.FC<Props> = ({ navigation }) => {
  const { dispatch } = useAppContext();
  const [phase, setPhase] = useState<Phase>('LIVENESS');
  const [detections, setDetections] = useState<FaceDetection[]>([]);
  const [matchedName, setMatchedName] = useState('');
  const [score, setScore] = useState(0);

  const [livenessState, setLivenessState] = useState<LivenessState>(() => {
    const seq = LivenessService.generateChallengeSequence(3);
    return {
      currentChallenge: seq[0],
      challengeIndex: 0,
      totalChallenges: 3,
      completed: false,
      failed: false,
      timeoutMs: AUTH_TIMEOUT_MS,
    };
  });

  const challengeSeq = useRef<LivenessChallenge[]>([]);
  const livenessScore = useRef(0);
  const lastFrameRef = useRef<{ pixels: Uint8Array; w: number; h: number } | null>(null);
  const gallery = useRef<Array<{ userId: string; embedding: FaceEmbedding }>>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Pre-load gallery from SQLite once
    StorageService.loadAllEmbeddings().then(embs => { gallery.current = embs; });

    challengeSeq.current = LivenessService.generateChallengeSequence(3);
    LivenessService.resetCounters();
    setLivenessState({
      currentChallenge: challengeSeq.current[0],
      challengeIndex: 0,
      totalChallenges: 3,
      completed: false,
      failed: false,
      timeoutMs: AUTH_TIMEOUT_MS,
    });

    timeoutRef.current = setTimeout(() => failAuth('Timed out'), AUTH_TIMEOUT_MS);
    return () => {
      clearTimeout(timeoutRef.current!);
      LivenessService.resetCounters();
    };
  }, []);

  const failAuth = (reason: string) => {
    clearTimeout(timeoutRef.current!);
    setLivenessState(s => ({ ...s, failed: true }));
    setPhase('FAIL');
    Vibration.vibrate([0, 80, 60, 80]);
    Alert.alert('Authentication Failed', reason, [
      { text: 'Retry', onPress: () => navigation.replace('Auth') },
      { text: 'Cancel', onPress: () => navigation.goBack() },
    ]);
  };

  const handleFaceDetected = useCallback(
    async (dets: FaceDetection[]) => {
      setDetections(dets);
      if (!dets.length || !lastFrameRef.current || phase === 'SUCCESS' || phase === 'FAIL') return;

      const { pixels, w, h } = lastFrameRef.current;

      // ── Phase 1: liveness ──────────────────────────────────────────────────
      if (phase === 'LIVENESS') {
        const landmarks = await LivenessService.extractLandmarks(pixels, w, h, dets[0].boundingBox);
        if (!landmarks) return;

        const current = challengeSeq.current[livenessState.challengeIndex];
        const done = LivenessService.evaluateFrame(landmarks, current);
        if (!done) return;

        LivenessService.resetCounters();
        livenessScore.current += 1;
        const nextIdx = livenessState.challengeIndex + 1;

        if (nextIdx >= livenessState.totalChallenges) {
          setLivenessState(s => ({ ...s, completed: true }));
          setPhase('RECOGNISE');
        } else {
          setLivenessState(s => ({
            ...s,
            challengeIndex: nextIdx,
            currentChallenge: challengeSeq.current[nextIdx],
          }));
        }
      }

      // ── Phase 2: recognition ───────────────────────────────────────────────
      if (phase === 'RECOGNISE') {
        const probe = await FaceRecognitionService.extractEmbedding(pixels, w, h, dets[0].boundingBox);
        const match = FaceRecognitionService.findMatch(probe, gallery.current);

        if (!match) {
          failAuth('Face not recognised. Please contact admin.');
          return;
        }

        clearTimeout(timeoutRef.current!);

        // Persist auth session
        const users = await StorageService.getAllUsers();
        const user = users.find(u => u.id === match.userId);
        const deviceId = await DeviceInfoService.getDeviceId();

        await StorageService.saveAuthSession({
          id: uuidv4(),
          userId: match.userId,
          timestamp: Date.now(),
          livenessScore: livenessScore.current / livenessState.totalChallenges,
          recognitionScore: match.similarity,
          deviceId,
        });

        const pending = await StorageService.getPendingSyncCount();
        dispatch({ type: 'SET_PENDING_SYNC', payload: pending });

        setMatchedName(user?.name ?? 'Unknown');
        setScore(Math.round(match.similarity * 100));
        setPhase('SUCCESS');
        Vibration.vibrate(80);
      }
    },
    [phase, livenessState, dispatch],
  );

  if (phase === 'SUCCESS') {
    return (
      <View style={styles.resultContainer}>
        <Text style={styles.successIcon}>✅</Text>
        <Text style={styles.successTitle}>Attendance Marked</Text>
        <Text style={styles.successName}>{matchedName}</Text>
        <Text style={styles.scoreText}>Match confidence: {score}%</Text>
        <Text style={styles.timeText}>{new Date().toLocaleTimeString()}</Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FaceCamera
        onFaceDetected={handleFaceDetected}
        overlayChildren={
          <LivenessOverlay
            livenessState={livenessState}
            faceDetected={detections.length > 0}
          />
        }
      />
      <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  cancelBtn: {
    position: 'absolute', top: 52, left: 20,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  cancelText: { color: '#FFF', fontWeight: '600' },
  resultContainer: {
    flex: 1, backgroundColor: '#000', justifyContent: 'center',
    alignItems: 'center', gap: 12, padding: 32,
  },
  successIcon: { fontSize: 72 },
  successTitle: { color: '#34C759', fontSize: 26, fontWeight: '800' },
  successName: { color: '#FFF', fontSize: 22, fontWeight: '600' },
  scoreText: { color: '#8E8E93', fontSize: 15 },
  timeText: { color: '#555', fontSize: 14 },
  doneBtn: { backgroundColor: '#0A84FF', borderRadius: 14, paddingHorizontal: 40, paddingVertical: 14, marginTop: 16 },
  doneBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
});

export default AuthScreen;
