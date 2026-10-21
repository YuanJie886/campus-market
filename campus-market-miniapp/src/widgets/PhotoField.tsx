import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import { useRef, useState } from 'react';
import { api, imageSrc, isDemo } from '../api';
import { addPickedFiles, addReadySlot, IMAGE_TOO_LARGE, moveSlot, photoLimits, removeSlot, slotFailed, slotProgress, slotRetrying, slotUploaded, type PhotoSlot } from '../images';
import { isPrivacyDenied, PRIVACY_REQUIRED_MESSAGE } from '../privacy';
import { requirePrivacy } from '../privacyGuard';
import { notify, useClientConfig } from '../state';

const SAMPLE_IMAGES = ['headphones', 'books', 'lamp', 'bike', 'bag', 'keyboard'];
export type PhotoUpdater = (update: (prev: PhotoSlot[]) => PhotoSlot[]) => void;

/** 照片上传：本机临时文件逐张上传（演示模式先 saveFile），每张单独显示进度与失败原因。返回上传成功的图片。 */
export async function uploadPhoto(slot: PhotoSlot, onProgress: (percent: number) => void) {
  let path = slot.filePath;
  if (isDemo && process.env.TARO_ENV !== 'h5') {
    // 演示模式不联网：把照片存成本机文件，演示库里只记路径
    const saved = await Taro.saveFile({ tempFilePath: path });
    if (!('savedFilePath' in saved)) throw new Error('图片本地保存失败，请重新选择');
    path = saved.savedFilePath;
  }
  return api.upload(path, onProgress);
}

/**
 * 商品照片（单件发布、整套打包、批量发布草稿共用）：相册 / 拍照（先检查隐私授权）、逐张上传、失败重试、移除、‹ › 调整顺序；
 * 张数与大小上限来自 /v1/config。提交时只取上传完成的引用（upload:<id>）。
 */
export function PhotoField({ photos, onChange, disabled = false, label = '商品图片' }: { photos: PhotoSlot[]; onChange: PhotoUpdater; disabled?: boolean; label?: string }) {
  const { max, maxBytes } = photoLimits(useClientConfig());
  const [picking, setPicking] = useState(false);
  const current = useRef(photos); current.current = photos;
  const uploading = photos.some((p) => p.status === 'uploading');

  const uploadSlot = async (slot: PhotoSlot) => {
    try { const image = await uploadPhoto(slot, (percent) => onChange((prev) => slotProgress(prev, slot.key, percent))); onChange((prev) => slotUploaded(prev, slot.key, image)); }
    catch (e) { onChange((prev) => slotFailed(prev, slot.key, e instanceof Error ? e : new Error('图片上传失败，请重试'))); }
  };
  const addPhoto = async () => {
    if (picking || disabled) return;
    if (current.current.length >= max) { notify(`最多 ${max} 张图片`); return; }
    setPicking(true);
    let queued: PhotoSlot[] = [];
    try {
      await requirePrivacy();
      const selected = await Taro.chooseMedia({ count: max - current.current.length, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const added = addPickedFiles(current.current, selected.tempFiles.map((file) => ({ path: file.tempFilePath, size: file.size })), max, maxBytes);
      current.current = added.slots; onChange(() => added.slots); queued = added.queued;
    } catch (e) {
      const message = (e as { errMsg?: string })?.errMsg ?? '';
      if (!message.includes('cancel')) notify(isPrivacyDenied(e) ? PRIVACY_REQUIRED_MESSAGE : e instanceof Error ? e.message : '没有选到照片，请重试');
    } finally { setPicking(false); }
    // 逐张上传（服务端按用户每小时限流），每张单独显示进度与失败原因
    for (const slot of queued) await uploadSlot(slot);
  };
  const retry = (slot: PhotoSlot) => {
    if (!slot.filePath || slot.error === IMAGE_TOO_LARGE) return;
    onChange((prev) => slotRetrying(prev, slot.key));
    void uploadSlot(slot);
  };

  return <View>
    <Text className='field-label'>{label} <Text className='optional'>（{photos.length}/{max}，第 1 张为主图）</Text></Text>
    <View className='photo-grid'>
      {photos.map((photo, i) => <View className={`photo-item ${photo.status}`} key={photo.key}>
        <Image src={imageSrc(photo.preview)} mode='aspectFill' onClick={() => { const src = imageSrc(photo.preview); if (src) void Taro.previewImage({ current: src, urls: photos.map((p) => imageSrc(p.preview)).filter(Boolean) }); }} />
        {i === 0 && <Text className='photo-main'>主图</Text>}
        {photo.status === 'uploading' && <Text className='photo-state'>上传中 {photo.progress}%</Text>}
        {photo.status === 'failed' && <View className='photo-state failed' onClick={() => retry(photo)}>
          <Text>{photo.error}</Text>{photo.filePath && photo.error !== IMAGE_TOO_LARGE ? <Text className='photo-retry'>点此重试</Text> : null}
        </View>}
        <Text className='remove-photo' aria-label='移除这张照片' onClick={() => onChange((prev) => removeSlot(prev, photo.key))}>×</Text>
        {photos.length > 1 && <View className='photo-order'>
          {i > 0 ? <Text className='photo-move' onClick={() => onChange((prev) => moveSlot(prev, photo.key, -1))}>‹</Text> : <Text className='photo-move disabled' />}
          {i < photos.length - 1 ? <Text className='photo-move' onClick={() => onChange((prev) => moveSlot(prev, photo.key, 1))}>›</Text> : <Text className='photo-move disabled' />}
        </View>}
      </View>)}
      {photos.length < max && <View className='add-photo' onClick={() => void addPhoto()}>
        <View className='i-camera' />
        <Text>{picking ? '正在选择' : uploading ? '继续添加' : '拍照 / 相册'}</Text>
      </View>}
    </View>
    {isDemo && <><Text className='field-help'>演示版也可以直接选一张示意插画</Text><View className='sample-images'>{SAMPLE_IMAGES.map((name) => <Image key={name} src={`/assets/goods/${name}.png`} mode='aspectFill' onClick={() => onChange((prev) => addReadySlot(prev, `/assets/goods/${name}.png`, `/assets/goods/${name}.png`, max))} />)}</View></>}
    <Text className='field-help'>支持 JPEG / PNG，每张不超过 {Math.round(maxBytes / 1048576)} MB；上传后会去掉拍摄地点等信息。用 ‹ › 调整顺序。</Text>
  </View>;
}
