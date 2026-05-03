import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

declare const process: { env?: Record<string, string | undefined> };

type PhotoItem = {
  id: string;
  key: string;
  url: string;
  fileName: string;
  type: 'photo' | 'video';
  size: number;
  createdAt: string;
};

type UploadJob = {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  size: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
};

type ScreenKey = 'photos' | 'upload';

const FALLBACK_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://localhost:8787';
const API_URL = (process.env?.EXPO_PUBLIC_PHOTOS_API_URL || FALLBACK_API_URL).replace(/\/$/, '');
const API_TOKEN = process.env?.EXPO_PUBLIC_PHOTOS_API_TOKEN;

function apiHeaders(extra?: Record<string, string>) {
  return {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    ...extra,
  };
}

function monthLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(date));
}

function compactBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

async function parseJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function uploadAsset(asset: ImagePicker.ImagePickerAsset) {
  const mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
  const filename = asset.fileName || `${asset.type || 'photo'}-${Date.now()}.${mimeType.split('/')[1] || 'jpg'}`;
  const size = asset.fileSize || 1;

  const presign = await fetch(`${API_URL}/photos/upload-url`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename, contentType: mimeType, size }),
  });
  const uploadTarget = await parseJsonResponse(presign);
  if (!presign.ok) throw new Error(uploadTarget.error || 'Could not create upload URL.');

  const fileResponse = await fetch(asset.uri);
  const blob = await fileResponse.blob();
  const uploaded = await fetch(uploadTarget.uploadUrl, {
    method: 'PUT',
    headers: uploadTarget.headers || { 'Content-Type': mimeType },
    body: blob,
  });
  if (!uploaded.ok) throw new Error(`Upload failed with HTTP ${uploaded.status}.`);
}

export default function App() {
  const [screen, setScreen] = useState<ScreenKey>('photos');
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/photos/list`, { headers: apiHeaders() });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Library sync failed.');
      setItems(Array.isArray(data.items) ? data.items : []);
      setApiOnline(true);
      setLastError(null);
    } catch (err) {
      setApiOnline(false);
      setLastError(err instanceof Error ? err.message : 'Could not reach the Photos API.');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadLibrary();
  }, [loadLibrary]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(item => item.fileName.toLowerCase().includes(needle) || item.key.toLowerCase().includes(needle));
  }, [items, query]);

  const monthGroups = useMemo(() => {
    const groups = new Map<string, PhotoItem[]>();
    for (const item of filtered) {
      const label = monthLabel(item.createdAt);
      groups.set(label, [...(groups.get(label) || []), item]);
    }
    return Array.from(groups.entries()).map(([label, data]) => ({ label, data }));
  }, [filtered]);

  const pickAndUpload = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    if (!permission.granted) {
      Alert.alert('Photos permission needed', 'Allow photo library access to upload selected photos and videos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
    });
    if (result.canceled || !result.assets.length) return;

    setScreen('upload');
    const selectedJobs = result.assets.map((asset, index): UploadJob => ({
      id: `${Date.now()}-${index}`,
      name: asset.fileName || `${asset.type || 'media'}-${index + 1}`,
      uri: asset.uri,
      mimeType: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      size: asset.fileSize || 0,
      status: 'queued',
    }));
    setJobs(prev => [...selectedJobs, ...prev]);

    for (const asset of result.assets) {
      const job = selectedJobs.find(candidate => candidate.uri === asset.uri);
      if (!job) continue;
      setJobs(prev => prev.map(current => current.id === job.id ? { ...current, status: 'uploading' } : current));
      try {
        await uploadAsset(asset);
        setJobs(prev => prev.map(current => current.id === job.id ? { ...current, status: 'done' } : current));
      } catch (err) {
        setJobs(prev => prev.map(current => current.id === job.id ? {
          ...current,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        } : current));
      }
    }
    loadLibrary();
  }, [loadLibrary]);

  const doneCount = jobs.filter(job => job.status === 'done').length;
  const activeCount = jobs.filter(job => job.status === 'queued' || job.status === 'uploading').length;
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <LinearGradient colors={['#071011', '#101820', '#171411']} style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <Text style={styles.brand}>Debajyoti Photos</Text>
            <Text style={styles.subtitle}>{apiOnline ? `${items.length} items synced · ${compactBytes(totalBytes)}` : 'Sync unavailable'}</Text>
          </View>
          <Pressable style={styles.syncPill} onPress={loadLibrary}>
            {refreshing ? <ActivityIndicator color="#f8efe3" size="small" /> : <Ionicons name="cloud-done-outline" size={18} color="#f8efe3" />}
          </Pressable>
        </View>

        <View style={styles.searchShell}>
          <Ionicons name="search-outline" size={18} color="#a7b0aa" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search photos and videos"
            placeholderTextColor="#7f8984"
            style={styles.searchInput}
          />
        </View>

        <View style={styles.heroStrip}>
          {items[0] ? (
            <ExpoImage source={{ uri: items[0].url }} style={styles.heroImage} contentFit="cover" transition={220} />
          ) : (
            <View style={styles.heroEmpty}>
              <Ionicons name="images-outline" size={32} color="#f6b35d" />
            </View>
          )}
          <LinearGradient colors={['transparent', 'rgba(7,16,17,0.92)']} style={styles.heroFade} />
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>{items[0] ? 'Latest' : 'No media yet'}</Text>
            <Text style={styles.heroMeta}>{items[0] ? 'Your newest S3-backed memory' : 'Upload photos and videos to start the library'}</Text>
          </View>
        </View>

        <View style={styles.segmented}>
          <SegmentButton active={screen === 'photos'} icon="images-outline" label="Photos" onPress={() => setScreen('photos')} />
          <SegmentButton active={screen === 'upload'} icon="cloud-upload-outline" label="Upload" onPress={() => setScreen('upload')} />
        </View>

        {lastError && !apiOnline && (
          <Pressable style={styles.errorBanner} onPress={loadLibrary}>
            <Ionicons name="warning-outline" size={17} color="#ffb09f" />
            <Text style={styles.errorText} numberOfLines={2}>{lastError}</Text>
          </Pressable>
        )}

        <View style={styles.content}>
          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#f6b35d" />
            </View>
          ) : screen === 'photos' ? (
            <FlatList
              data={monthGroups}
              keyExtractor={group => group.label}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadLibrary} tintColor="#f6b35d" />}
              ListEmptyComponent={<EmptyLibrary onUpload={pickAndUpload} />}
              renderItem={({ item }) => (
                <View style={styles.monthBlock}>
                  <Text style={styles.monthLabel}>{item.label}</Text>
                  <View style={styles.grid}>
                    {item.data.map((photo, index) => <PhotoTile key={photo.id} item={photo} large={index % 7 === 0} />)}
                  </View>
                </View>
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listPad}
            />
          ) : (
            <FlatList
              data={jobs}
              keyExtractor={job => job.id}
              ListHeaderComponent={(
                <View style={styles.uploadHeader}>
                  <Pressable style={styles.uploadButton} onPress={pickAndUpload}>
                    <Ionicons name="add-circle" size={22} color="#101820" />
                    <Text style={styles.uploadButtonText}>Select photos and videos</Text>
                  </Pressable>
                  <Text style={styles.uploadSummary}>
                    {activeCount > 0 ? `${activeCount} active` : `${doneCount} uploaded`} · {API_URL}
                  </Text>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No uploads in this session.</Text>}
              renderItem={({ item }) => <UploadRow job={item} />}
              contentContainerStyle={styles.uploadList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        <Pressable style={styles.fab} onPress={pickAndUpload}>
          <Ionicons name="cloud-upload" size={24} color="#101820" />
        </Pressable>
      </LinearGradient>
    </SafeAreaView>
  );
}

function SegmentButton({ active, icon, label, onPress }: { active: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentButton, active && styles.segmentButtonActive]} onPress={onPress}>
      <Ionicons name={icon} size={18} color={active ? '#101820' : '#d6dbd5'} />
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function EmptyLibrary({ onUpload }: { onUpload: () => void }) {
  return (
    <View style={styles.emptyLibrary}>
      <Ionicons name="sparkles-outline" size={34} color="#f6b35d" />
      <Text style={styles.emptyTitle}>Your photo cloud is ready</Text>
      <Text style={styles.emptyBody}>Back up selected photos and videos into your private S3 photo library.</Text>
      <Pressable style={styles.emptyButton} onPress={onUpload}>
        <Text style={styles.emptyButtonText}>Upload media</Text>
      </Pressable>
    </View>
  );
}

function PhotoTile({ item, large }: { item: PhotoItem; large: boolean }) {
  return (
    <Pressable style={[styles.photoTile, large && styles.photoTileLarge]}>
      <ExpoImage source={{ uri: item.url }} style={styles.photoImage} contentFit="cover" transition={220} />
      {item.type === 'video' && (
        <View style={styles.videoBadge}>
          <Ionicons name="play" size={12} color="#f8efe3" />
        </View>
      )}
    </Pressable>
  );
}

function UploadRow({ job }: { job: UploadJob }) {
  const statusIcon = job.status === 'done'
    ? 'checkmark-circle'
    : job.status === 'error'
      ? 'warning'
      : job.status === 'uploading'
        ? 'cloud-upload'
        : 'time-outline';

  return (
    <View style={styles.uploadRow}>
      <ExpoImage source={{ uri: job.uri }} style={styles.uploadThumb} contentFit="cover" />
      <View style={styles.uploadInfo}>
        <Text style={styles.uploadName} numberOfLines={1}>{job.name}</Text>
        <Text style={styles.uploadMeta} numberOfLines={1}>{job.status} · {compactBytes(job.size)}{job.error ? ` · ${job.error}` : ''}</Text>
      </View>
      <Ionicons name={statusIcon} size={21} color={job.status === 'error' ? '#ff8a7a' : '#f6b35d'} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#071011',
  },
  screen: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
  },
  brand: {
    color: '#f8efe3',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#a7b0aa',
    fontSize: 13,
    marginTop: 2,
  },
  syncPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,239,227,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248,239,227,0.15)',
  },
  searchShell: {
    minHeight: 46,
    borderRadius: 23,
    paddingHorizontal: 14,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(248,239,227,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248,239,227,0.1)',
  },
  searchInput: {
    flex: 1,
    color: '#f8efe3',
    fontSize: 16,
    minHeight: 44,
  },
  heroStrip: {
    height: 154,
    marginTop: 16,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1c2524',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroEmpty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#162321',
  },
  heroFade: {
    ...StyleSheet.absoluteFillObject,
  },
  heroCopy: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  heroTitle: {
    color: '#f8efe3',
    fontSize: 29,
    fontWeight: '800',
  },
  heroMeta: {
    color: '#d6dbd5',
    fontSize: 13,
    marginTop: 2,
  },
  segmented: {
    minHeight: 48,
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(248,239,227,0.08)',
  },
  segmentButtonActive: {
    backgroundColor: '#f6b35d',
  },
  segmentText: {
    color: '#d6dbd5',
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#101820',
  },
  errorBanner: {
    minHeight: 46,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 138, 122, 0.11)',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 122, 0.22)',
  },
  errorText: {
    flex: 1,
    color: '#ffcfbf',
    fontSize: 12,
  },
  content: {
    flex: 1,
    marginTop: 10,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listPad: {
    paddingBottom: 108,
    flexGrow: 1,
  },
  monthBlock: {
    marginBottom: 24,
  },
  monthLabel: {
    color: '#f8efe3',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  photoTile: {
    width: '32.5%',
    aspectRatio: 1,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#23302d',
  },
  photoTileLarge: {
    width: '66%',
    aspectRatio: 1.62,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  emptyLibrary: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  emptyTitle: {
    color: '#f8efe3',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 12,
  },
  emptyBody: {
    color: '#a7b0aa',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
  },
  emptyButton: {
    minHeight: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    backgroundColor: '#f6b35d',
  },
  emptyButtonText: {
    color: '#101820',
    fontSize: 14,
    fontWeight: '800',
  },
  uploadHeader: {
    gap: 10,
    paddingTop: 4,
    paddingBottom: 12,
  },
  uploadButton: {
    minHeight: 50,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f6b35d',
  },
  uploadButtonText: {
    color: '#101820',
    fontSize: 15,
    fontWeight: '800',
  },
  uploadSummary: {
    color: '#a7b0aa',
    fontSize: 12,
  },
  uploadList: {
    paddingBottom: 108,
    flexGrow: 1,
  },
  emptyText: {
    color: '#a7b0aa',
    fontSize: 14,
    marginTop: 24,
    textAlign: 'center',
  },
  uploadRow: {
    minHeight: 72,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(248,239,227,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248,239,227,0.1)',
  },
  uploadThumb: {
    width: 54,
    height: 54,
    borderRadius: 6,
    backgroundColor: '#23302d',
  },
  uploadInfo: {
    flex: 1,
    minWidth: 0,
  },
  uploadName: {
    color: '#f8efe3',
    fontSize: 14,
    fontWeight: '800',
  },
  uploadMeta: {
    color: '#a7b0aa',
    fontSize: 12,
    marginTop: 4,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 26,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6b35d',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 8,
  },
});
