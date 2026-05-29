import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { LivenessChallenge, LivenessState } from '../types';

const { width: SCREEN_W } = Dimensions.get('window');
const OVAL_W = SCREEN_W * 0.68;
const OVAL_H = OVAL_W * 1.32;

const CHALLENGE_LABELS: Record<LivenessChallenge, string> = {
  BLINK: 'Blink your eyes',
  SMILE: 'Smile please',
  TURN_LEFT: 'Turn head left',
  TURN_RIGHT: 'Turn head right',
};

const CHALLENGE_ICONS: Record<LivenessChallenge, string> = {
  BLINK: '👁️',
  SMILE: '😊',
  TURN_LEFT: '⬅️',
  TURN_RIGHT: '➡️',
};

interface LivenessOverlayProps {
  livenessState: LivenessState;
  faceDetected: boolean;
}

const LivenessOverlay: React.FC<LivenessOverlayProps> = ({
  livenessState,
  faceDetected,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  // Pulse the oval when a face is detected
  useEffect(() => {
    if (faceDetected) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.04, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [faceDetected, pulseAnim]);

  // Fade in instruction on challenge change
  useEffect(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [livenessState.challengeIndex, fadeAnim]);

  const ovalColor = livenessState.failed
    ? '#FF3B30'
    : livenessState.completed
    ? '#34C759'
    : faceDetected
    ? '#FFFFFF'
    : '#888888';

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Darkened corners */}
      <View style={styles.backdrop} />

      {/* Face oval guide */}
      <Animated.View style={[styles.ovalContainer, { transform: [{ scale: pulseAnim }] }]}>
        <Svg width={OVAL_W + 8} height={OVAL_H + 8}>
          <Ellipse
            cx={(OVAL_W + 8) / 2}
            cy={(OVAL_H + 8) / 2}
            rx={OVAL_W / 2}
            ry={OVAL_H / 2}
            stroke={ovalColor}
            strokeWidth={3}
            fill="transparent"
          />
        </Svg>
      </Animated.View>

      {/* Progress dots */}
      <View style={styles.progressRow}>
        {Array.from({ length: livenessState.totalChallenges }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < livenessState.challengeIndex && styles.dotDone,
              i === livenessState.challengeIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>

      {/* Instruction card */}
      <Animated.View style={[styles.instructionCard, { opacity: fadeAnim }]}>
        {livenessState.completed ? (
          <Text style={styles.successText}>✅  Liveness Verified!</Text>
        ) : livenessState.failed ? (
          <Text style={styles.failText}>❌  Verification Failed</Text>
        ) : (
          <>
            <Text style={styles.icon}>
              {CHALLENGE_ICONS[livenessState.currentChallenge]}
            </Text>
            <Text style={styles.instruction}>
              {CHALLENGE_LABELS[livenessState.currentChallenge]}
            </Text>
            <Text style={styles.stepText}>
              Step {livenessState.challengeIndex + 1} of {livenessState.totalChallenges}
            </Text>
          </>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  ovalContainer: {
    position: 'absolute',
    top: '12%',
    alignSelf: 'center',
  },
  progressRow: {
    position: 'absolute',
    top: '8%',
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#555',
  },
  dotDone: {
    backgroundColor: '#34C759',
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
    width: 24,
    borderRadius: 5,
  },
  instructionCard: {
    position: 'absolute',
    bottom: '14%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 4,
  },
  icon: {
    fontSize: 32,
  },
  instruction: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  stepText: {
    color: '#AAAAAA',
    fontSize: 13,
    marginTop: 2,
  },
  successText: {
    color: '#34C759',
    fontSize: 18,
    fontWeight: '700',
  },
  failText: {
    color: '#FF3B30',
    fontSize: 18,
    fontWeight: '700',
  },
});

export default LivenessOverlay;
