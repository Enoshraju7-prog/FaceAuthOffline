import React, { useEffect } from 'react';
import { Platform, Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Camera } from 'react-native-vision-camera';
import { AppProvider } from './src/store/AppContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  useEffect(() => {
    requestCameraPermission();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <AppNavigator />
      </AppProvider>
    </GestureHandlerRootView>
  );
}

async function requestCameraPermission() {
  const status = await Camera.requestCameraPermission();
  if (status !== 'granted') {
    Alert.alert(
      'Camera Required',
      'FaceAuth needs camera access for facial recognition. Please enable it in Settings.',
    );
  }
}
