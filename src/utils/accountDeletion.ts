/**
 * accountDeletion.ts — 앱 안에서 계정과 서버 데이터를 지웁니다(출시 점검 2026-09-30).
 *
 * Play 정책: 앱에서 계정을 만들 수 있으면 **앱 안에서도** 계정 삭제를 요청할 수 있어야 합니다.
 * 예전에는 웹 페이지(bglow.pplaner.com/delete-account.html)의 메일 요청뿐이었고, 개인정보처리방침은
 * "앱 내 설정을 통해 탈퇴" 한다고 적고 있었습니다.
 *
 * 지우는 것(모두 Firestore/Storage 규칙상 주인만 지울 수 있는 것):
 *  1. 전역 갤러리의 내 사진 문서  `global_photos` where userId == uid
 *  2. 내 사진 기록                `users/{uid}/photos/*`
 *  3. 저장한 장소                 `users/{uid}/locations/*`
 *  4. 올린 사진 파일              Storage `photos/{uid}/**`
 *  5. 로그인 계정                 Firebase Auth 사용자
 *
 * 로그인한 지 오래되면 Firebase 가 `auth/requires-recent-login` 으로 계정 삭제를 거절합니다. 그때는
 * 데이터는 이미 지워졌으므로, 다시 로그인한 뒤 한 번 더 누르면 계정만 지워집니다.
 */
import { deleteUser } from 'firebase/auth';
import { collection, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { deleteObject, listAll, ref, type StorageReference } from 'firebase/storage';
import { auth, db, storage } from '../config/firebase';

export type DeleteAccountResult =
  | { ok: true; docs: number; files: number }
  | { ok: false; reason: 'not-signed-in' | 'requires-recent-login' | 'failed'; docs: number; files: number; message?: string };

async function deleteFolder(folder: StorageReference): Promise<number> {
  const res = await listAll(folder);
  let n = 0;
  for (const item of res.items) {
    await deleteObject(item);
    n++;
  }
  for (const sub of res.prefixes) n += await deleteFolder(sub);
  return n;
}

export async function deleteAccountAndData(): Promise<DeleteAccountResult> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, reason: 'not-signed-in', docs: 0, files: 0 };
  const uid = user.uid;
  let docs = 0;
  let files = 0;
  try {
    const globals = await getDocs(query(collection(db, 'global_photos'), where('userId', '==', uid)));
    for (const d of globals.docs) { await deleteDoc(d.ref); docs++; }
    for (const sub of ['photos', 'locations']) {
      const snap = await getDocs(collection(db, `users/${uid}/${sub}`));
      for (const d of snap.docs) { await deleteDoc(d.ref); docs++; }
    }
    files = await deleteFolder(ref(storage, `photos/${uid}`));
  } catch (e: any) {
    return { ok: false, reason: 'failed', docs, files, message: e?.message };
  }
  try {
    await deleteUser(user);
    return { ok: true, docs, files };
  } catch (e: any) {
    if (e?.code === 'auth/requires-recent-login') return { ok: false, reason: 'requires-recent-login', docs, files };
    return { ok: false, reason: 'failed', docs, files, message: e?.message };
  }
}

export const PRIVACY_URL = 'https://bglow.pplaner.com/privacy.html';
export const DELETE_ACCOUNT_URL = 'https://bglow.pplaner.com/delete-account.html';
