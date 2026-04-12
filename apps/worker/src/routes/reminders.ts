import { Hono } from 'hono';
import {
  getReminders,
  getReminderById,
  createReminder,
  updateReminder,
  deleteReminder,
  getReminderSteps,
  createReminderStep,
  deleteReminderStep,
  enrollFriendInReminder,
  getFriendReminders,
  cancelFriendReminder,
} from '@line-crm/db';
import { checkOwnership } from '../middleware/tenant.js';
import type { Env } from '../index.js';

const reminders = new Hono<Env>();

// ========== リマインダCRUD ==========

reminders.get('/api/reminders', async (c) => {
  try {
    const lineAccountId = c.get('resolvedLineAccountId') ?? c.req.query('lineAccountId');
    let items: Awaited<ReturnType<typeof getReminders>>;
    if (lineAccountId) {
      const result = await c.env.DB
        .prepare(`SELECT * FROM reminders WHERE line_account_id = ? ORDER BY created_at DESC`)
        .bind(lineAccountId)
        .all();
      items = result.results as unknown as Awaited<ReturnType<typeof getReminders>>;
    } else {
      items = await getReminders(c.env.DB);
    }
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/reminders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const [reminder, steps] = await Promise.all([
      getReminderById(c.env.DB, id),
      getReminderSteps(c.env.DB, id),
    ]);
    if (!reminder) return c.json({ success: false, error: 'Reminder not found' }, 404);
    const reminderR = reminder as unknown as Record<string, unknown>;
    if (!checkOwnership(c.get('staff'), (reminderR.line_account_id as string | null) ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    return c.json({
      success: true,
      data: {
        id: reminder.id,
        name: reminder.name,
        description: reminder.description,
        isActive: Boolean(reminder.is_active),
        createdAt: reminder.created_at,
        updatedAt: reminder.updated_at,
        steps: steps.map((s) => ({
          id: s.id,
          reminderId: s.reminder_id,
          offsetMinutes: s.offset_minutes,
          messageType: s.message_type,
          messageContent: s.message_content,
          createdAt: s.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.post('/api/reminders', async (c) => {
  try {
    const body = await c.req.json<{ name: string; description?: string; lineAccountId?: string | null }>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    const staff = c.get('staff');
    const resolvedAccountId = staff.role !== 'owner' ? staff.lineAccountId : (body.lineAccountId ?? null);
    const item = await createReminder(c.env.DB, body);
    // Save line_account_id
    if (resolvedAccountId) {
      await c.env.DB.prepare(`UPDATE reminders SET line_account_id = ? WHERE id = ?`)
        .bind(resolvedAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, name: item.name, createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.put('/api/reminders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existingReminder = await getReminderById(c.env.DB, id);
    if (!existingReminder) return c.json({ success: false, error: 'Not found' }, 404);
    const existingReminderR = existingReminder as unknown as Record<string, unknown>;
    if (!checkOwnership(c.get('staff'), (existingReminderR.line_account_id as string | null) ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    const body = await c.req.json();
    await updateReminder(c.env.DB, id, body);
    const updated = await getReminderById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:id', async (c) => {
  try {
    const existingReminderDel = await getReminderById(c.env.DB, c.req.param('id'));
    if (!existingReminderDel) return c.json({ success: false, error: 'Reminder not found' }, 404);
    const existingReminderDelR = existingReminderDel as unknown as Record<string, unknown>;
    if (!checkOwnership(c.get('staff'), (existingReminderDelR.line_account_id as string | null) ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    await deleteReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== リマインダステップ ==========

reminders.post('/api/reminders/:id/steps', async (c) => {
  try {
    const reminderId = c.req.param('id');
    const parentReminder = await getReminderById(c.env.DB, reminderId);
    if (!parentReminder) return c.json({ success: false, error: 'Reminder not found' }, 404);
    if (!checkOwnership(c.get('staff'), (parentReminder as unknown as Record<string, unknown>).line_account_id as string | null ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    const body = await c.req.json<{ offsetMinutes: number; messageType: string; messageContent: string }>();
    if (body.offsetMinutes === undefined || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'offsetMinutes, messageType, messageContent are required' }, 400);
    }
    const step = await createReminderStep(c.env.DB, { reminderId, ...body });
    return c.json({
      success: true,
      data: { id: step.id, reminderId: step.reminder_id, offsetMinutes: step.offset_minutes, messageType: step.message_type, createdAt: step.created_at },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/steps error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:reminderId/steps/:stepId', async (c) => {
  try {
    const reminderId = c.req.param('reminderId');
    const stepId = c.req.param('stepId');
    const parentReminder = await getReminderById(c.env.DB, reminderId);
    if (!parentReminder) return c.json({ success: false, error: 'Reminder not found' }, 404);
    if (!checkOwnership(c.get('staff'), (parentReminder as unknown as Record<string, unknown>).line_account_id as string | null ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    const stepToDelete = await c.env.DB
      .prepare(`SELECT reminder_id FROM reminder_steps WHERE id = ?`)
      .bind(stepId)
      .first<{ reminder_id: string }>();
    if (!stepToDelete || stepToDelete.reminder_id !== reminderId) {
      return c.json({ success: false, error: 'Step not found' }, 404);
    }
    await deleteReminderStep(c.env.DB, stepId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:reminderId/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 友だちリマインダ登録 ==========

reminders.post('/api/reminders/:id/enroll/:friendId', async (c) => {
  try {
    const reminderId = c.req.param('id');
    const friendId = c.req.param('friendId');
    const [reminder, friend] = await Promise.all([
      getReminderById(c.env.DB, reminderId),
      c.env.DB.prepare(`SELECT line_account_id FROM friends WHERE id = ?`).bind(friendId).first<{ line_account_id: string | null }>(),
    ]);
    if (!reminder) return c.json({ success: false, error: 'Reminder not found' }, 404);
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    const staff = c.get('staff');
    if (!checkOwnership(staff, (reminder as unknown as Record<string, unknown>).line_account_id as string | null ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    if (!checkOwnership(staff, friend.line_account_id ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    const body = await c.req.json<{ targetDate: string }>();
    if (!body.targetDate) return c.json({ success: false, error: 'targetDate is required' }, 400);
    const enrollment = await enrollFriendInReminder(c.env.DB, { friendId, reminderId, targetDate: body.targetDate });
    return c.json({
      success: true,
      data: { id: enrollment.id, friendId: enrollment.friend_id, reminderId: enrollment.reminder_id, targetDate: enrollment.target_date, status: enrollment.status },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/enroll/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/friends/:friendId/reminders', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const friendCheck = await c.env.DB
      .prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
      .bind(friendId)
      .first<{ line_account_id: string | null }>();
    if (!friendCheck) return c.json({ success: false, error: 'Friend not found' }, 404);
    if (!checkOwnership(c.get('staff'), friendCheck.line_account_id ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    const items = await getFriendReminders(c.env.DB, friendId);
    return c.json({
      success: true,
      data: items.map((fr) => ({
        id: fr.id,
        friendId: fr.friend_id,
        reminderId: fr.reminder_id,
        targetDate: fr.target_date,
        status: fr.status,
        createdAt: fr.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/friends/:friendId/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/friend-reminders/:id', async (c) => {
  try {
    const frId = c.req.param('id');
    const fr = await c.env.DB
      .prepare(`SELECT fr.reminder_id, f.line_account_id FROM friend_reminders fr JOIN friends f ON f.id = fr.friend_id WHERE fr.id = ?`)
      .bind(frId)
      .first<{ reminder_id: string; line_account_id: string | null }>();
    if (!fr) return c.json({ success: false, error: 'Not found' }, 404);
    if (!checkOwnership(c.get('staff'), fr.line_account_id ?? null)) {
      return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
    }
    await cancelFriendReminder(c.env.DB, frId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friend-reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { reminders };
