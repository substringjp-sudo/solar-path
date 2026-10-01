/**
 * notificationScheduler.ts — 알림 계획(`notificationPlan.ts`)을 기기 알림으로 예약합니다.
 *
 * ⚠ 예전에는 노을 알림을 예약할 때 `cancelAllScheduledNotificationsAsync()` 로 **모든** 예약을
 *   지웠습니다. 그러면 먼저 예약된 일출 알림까지 사라질 수 있었습니다(2026-09-30). 이제 종류마다
 *   id 머리(`sunset-alert-day-`, `sunrise-alert`, `sky-`)로 자기 것만 지웁니다.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { PlannedNotification } from './notificationPlan';

export const SKY_CHANNEL = 'beforeglow-sky-channel';

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync(SKY_CHANNEL, {
    name: 'Sky events',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  }).catch(() => {});
}

/** 이 머리로 시작하는 예약만 지웁니다. */
export async function cancelScheduledByPrefix(prefix: string): Promise<number> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const mine = all.filter((n) => n.identifier.startsWith(prefix));
    await Promise.all(mine.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    return mine.length;
  } catch {
    return 0;
  }
}

export async function hasNotificationPermission(ask: boolean): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.status === 'granted') return true;
    if (!ask) return false;
    const next = await Notifications.requestPermissionsAsync();
    return next.status === 'granted';
  } catch {
    return false;
  }
}

/** 하늘 이벤트 알림을 계획대로 다시 예약합니다(예전 `sky-` 예약은 지움). */
export async function scheduleSkyPlan(plan: PlannedNotification[]): Promise<number> {
  await cancelScheduledByPrefix('sky-');
  let n = 0;
  for (const p of plan) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: {
          title: p.title,
          body: p.body,
          sound: true,
          data: { kind: p.kind, eventAt: p.eventAt.toISOString() },
          ...(Platform.OS === 'android' ? { channelId: SKY_CHANNEL } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.fireAt },
      });
      n++;
    } catch (e) {
      if (__DEV__) console.warn('[SkyNotif] schedule failed', p.id, e);
    }
  }
  if (__DEV__) console.log(`[SkyNotif] scheduled ${n}/${plan.length}`);
  return n;
}
