/**
 * reportContent.ts — 전역 갤러리 사진 신고(출시 점검 2026-09-30).
 *
 * Play 사용자 제작 콘텐츠 정책: 다른 사람이 올린 콘텐츠를 보여 주는 앱은 **앱 안에서 신고**할 수 있어야
 * 하고, 불쾌한 사용자를 **차단**할 수 있어야 합니다. 신고는 Firestore `reports` 에 한 건씩 남고
 * (규칙: 만들기만 가능, 읽기·수정 불가), 운영자가 콘솔에서 확인해 사진을 내립니다.
 */
import { addDoc, collection } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

export type ReportReason = 'inappropriate' | 'spam' | 'privacy' | 'other';
export const REPORT_REASONS: ReportReason[] = ['inappropriate', 'spam', 'privacy', 'other'];

export async function reportPhoto(photoId: string, ownerId: string, reason: ReportReason): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    await addDoc(collection(db, 'reports'), { photoId, ownerId, reporterId: uid, reason, createdAt: Date.now() });
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[Report] failed', e);
    return false;
  }
}
