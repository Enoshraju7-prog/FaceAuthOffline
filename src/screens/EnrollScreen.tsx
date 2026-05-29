import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  SafeAreaView, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, FaceDetection, LivenessState, LivenessChallenge } from '../types';
import FaceCamera from '../components/FaceCamera';
import LivenessOverlay from '../components/LivenessOverlay';
import FaceDetectionService from '../services/FaceDetectionService';
import FaceRecognitionService from '../services/FaceRecognitionService';
import LivenessService from '../services/LivenessService';
import StorageService from '../services/StorageService';
import { useAppContext } from '../store/AppContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Enroll'> };

type Step = 'FORM' | 'LIVENESS' | 'CAPTURE' | 'DONE';

const MULTI_CAPTURE_COUNT = 5; // capture 5 angles for robustness

const EnrollScreen: React.FC<Props> = ({ navigation }) => {
  const { dispatch } = useAppContext();
  const [step, setStep] = useState<Step>('FORM');
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('');
  const [detections, setDetections] = useState<FaceDetection[]>([]);
  const [liveness, setLiveness] = useState<LivenessState>({
    currentChallenge: 'BLINK',
    challengeIndex: 0,
    totalChallenges: 3,
    completed: false,
    failed: false,
    timeoutMs: 15_000,
  });
  const [enrolling, setEnrolling] = useState(false);

  // Liveness challenge sequence
  const challengeSeq = useRef<LivenessChallenge[]>([]);
  const capturedEmbeddings = useRef<Float32Array[]>([]);
  const lastFrameRef = useRef<{ pixels: Uint8Array; w: number; h: number } | null>(null);
  const livenessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureCount = useRef(0);

  // ─── Step 1: validate form ───────────────────────────────────────────────────
  const startLiveness = () => {
    if (!name.trim() || !employeeId.trim()) {
      Alert.alert('Missing Fields', 'Please enter name and employee ID.');
      return;
    }
    challengeSeq.current = LivenessService.generateChallengeSequence(3);
    LivenessService.resetCounters();
    setLiveness({
      currentChallenge: challengeSeq.current[0],
      challengeIndex: 0,
      totalChallenges: 3,
      completed: false,
      failed: false,
      timeoutMs: 15_000,
    });
    setStep('LIVENESS');

    livenessTimeoutRef.current = setTimeout(() => {
      setLiveness(s => ({ ...s, failed: true }));
      Alert.alert('Timeout', 'Liveness check timed out. Please try again.', [
        { text: 'Retry', onPress: () => setStep('FORM') },
      ]);
    }, 15_000);
  };

  // ─── Live frame processing ───────────────────────────────────────────────────
  const handleFaceDetected = useCallback(
    async (dets: FaceDetection[]) => {
      setDetections(dets);
      if (!dets.length || !lastFrameRef.current) return;

      const { pixels, w, h } = lastFrameRef.current;

      if (step === 'LIVENESS') {
        const landmarks = await LivenessService.extractLandmarks(
          pixels, w, h, dets[0].boundingBox,
        );
        if (!landmarks) return;

        const current = challengeSeq.current[liveness.challengeIndex];
        const done = LivenessService.evaluateFrame(landmarks, current);

        if (done) {
          LivenessService.resetCounters();
          const nextIdx = liveness.challengeIndex + 1;

          if (nextIdx >= liveness.totalChallenges) {
            clearTimeout(livenessTimeoutRef.current!);
            setLiveness(s => ({ ...s, completed: true }));
            setTimeout(() => {
              setStep('CAPTURE');
              captureCount.current = 0;
              capturedEmbeddings.current = [];
            }, 800);
          } else {
            setLiveness(s => ({
              ...s,
              challengeIndex: nextIdx,
              currentChallenge: challengeSeq.current[nextIdx],
            }));
          }
        }
      }

      if (step === 'CAPTURE') {
        const embedding = await FaceRecognitionService.extractEmbedding(
          pixels, w, h, dets[0].boundingBox,
        );
        capturedEmbeddings.current.push(embedding);
        captureCount.current++;

        if (captureCount.current >= MULTI_CAPTURE_COUNT) {
          await finaliseEnrolment();
        }
      }
    },
    [step, liveness],
  );

  // ─── Average embeddings and save ────────────────────────────────────────────
  const finaliseEnrolment = async () => {
    setEnrolling(true);
    try {
      const embs = capturedEmbeddings.current;
      const averaged = new Float32Array(embs[0].length);
      embs.forEach(e => e.forEach((v, i) => (averaged[i] += v)));
      averaged.forEach((_, i) => (averaged[i] /= embs.length));

      await StorageService.enrollUser(
        name.trim(),
        employeeId.trim(),
        department.trim(),
        averaged,
      );

      const count = await StorageService.getEnrolledUserCount();
      dispatch({ type: 'SET_USER_COUNT', payload: count });

      setStep('DONE');
    } catch (err) {
      Alert.alert('Enrolment Failed', String(err));
    } finally {
      setEnrolling(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (step === 'DONE') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.doneContainer}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>Enrolled Successfully</Text>
          <Text style={styles.doneSub}>{name} has been registered.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
            <Text style={styles.btnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'LIVENESS' || step === 'CAPTURE') {
    return (
      <View style={styles.cameraContainer}>
        <FaceCamera
          onFaceDetected={handleFaceDetected}
          overlayChildren={
            <LivenessOverlay
              livenessState={liveness}
              faceDetected={detections.length > 0}
            />
          }
        />
        {step === 'CAPTURE' && (
          <View style={styles.captureProgress}>
            <Text style={styles.captureText}>
              Capturing face... {captureCount.current}/{MULTI_CAPTURE_COUNT}
            </Text>
            {enrolling && <ActivityIndicator color="#FFFFFF" />}
          </View>
        )}
      </View>
    );
  }

  // step === 'FORM'
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Enrol New User</Text>
        <Text style={styles.label}>Full Name *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Arjun Mehta"
          placeholderTextColor="#555"
        />
        <Text style={styles.label}>Employee ID *</Text>
        <TextInput
          style={styles.input}
          value={employeeId}
          onChangeText={setEmployeeId}
          placeholder="e.g. EMP-00123"
          placeholderTextColor="#555"
        />
        <Text style={styles.label}>Department</Text>
        <TextInput
          style={styles.input}
          value={department}
          onChangeText={setDepartment}
          placeholder="e.g. Field Operations"
          placeholderTextColor="#555"
        />
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            After submitting you will be asked to complete a 3-step liveness check (blink, smile,
            head-turn) before your face is captured from 5 angles and stored securely on-device.
          </Text>
        </View>
        <TouchableOpacity style={styles.btn} onPress={startLiveness}>
          <Text style={styles.btnText}>Start Enrolment →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  form: { padding: 24, gap: 10 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 16 },
  label: { color: '#8E8E93', fontSize: 13, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: '#1C1C1E', color: '#FFF', borderRadius: 12,
    padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#2C2C2E',
  },
  infoBox: { backgroundColor: '#1C2340', borderRadius: 12, padding: 14, marginTop: 8 },
  infoText: { color: '#A0AECF', fontSize: 13, lineHeight: 20 },
  btn: { backgroundColor: '#0A84FF', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  cameraContainer: { flex: 1 },
  captureProgress: {
    position: 'absolute', bottom: 60, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 10, flexDirection: 'row', gap: 8, alignItems: 'center',
  },
  captureText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  doneContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
  doneIcon: { fontSize: 64 },
  doneTitle: { fontSize: 26, fontWeight: '700', color: '#FFF' },
  doneSub: { color: '#8E8E93', fontSize: 16 },
});

export default EnrollScreen;
