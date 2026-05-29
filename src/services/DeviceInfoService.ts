import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';

const DEVICE_ID_KEY = '@faceauth/device_id';
const ENC_KEY_KEY   = '@faceauth/enc_key';

/**
 * Provides a stable per-device UUID and a derived AES key.
 * On first launch both are generated and persisted in AsyncStorage.
 * The encryption key is derived via PBKDF2 from the device UUID so it is
 * both unique and deterministic across app restarts.
 */
class DeviceInfoService {
  private _deviceId: string | null = null;
  private _encKey: string | null = null;

  async getDeviceId(): Promise<string> {
    if (this._deviceId) return this._deviceId;

    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = uuidv4();
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    this._deviceId = id;
    return id;
  }

  async getEncryptionKey(): Promise<string> {
    if (this._encKey) return this._encKey;

    let key = await AsyncStorage.getItem(ENC_KEY_KEY);
    if (!key) {
      const deviceId = await this.getDeviceId();
      const salt = CryptoJS.lib.WordArray.random(128 / 8);
      key = CryptoJS.PBKDF2(deviceId, salt, { keySize: 256 / 32, iterations: 1000 }).toString();
      await AsyncStorage.setItem(ENC_KEY_KEY, key);
    }
    this._encKey = key;
    return key;
  }

  getOS(): string {
    return Platform.OS === 'android' ? 'Android' : 'iOS';
  }
}

export default new DeviceInfoService();
