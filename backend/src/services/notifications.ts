import { Notification, NotificationLog, User } from '../database/models.js';

type NotificationType = 'message' | 'order';

export async function createInAppNotification(userId: unknown, type: NotificationType, title: string, message: string, metadata?: Record<string, unknown>) {
  const user: any = await User.findById(userId).select('notificationPreferences isActive isDeleted').lean();
  if (!user || user.isActive === false || user.isDeleted === true) return null;
  const preferenceKey = type === 'message' ? 'messages' : 'orders';
  // Unset preferences use the explicit product default (enabled), preserving
  // the existing in-app message behavior for accounts without saved settings.
  if (user.notificationPreferences?.[preferenceKey] === false) return null;
  const createdAt = new Date();
  const notification: any = await Notification.create({
    user: user._id, userId: user._id, type, title, message,
    ...(metadata ? { metadata } : {}), isRead: false, read: false, createdAt,
  });
  await NotificationLog.create({
    userId: user._id, notificationId: notification._id, type, channel: 'in_app',
    status: 'created', createdAt,
  });
  return notification;
}
