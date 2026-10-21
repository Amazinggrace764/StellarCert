import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', unique: true })
  @Index()
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ default: true, name: 'in_app_enabled' })
  inAppEnabled: boolean;

  @Column({ default: true, name: 'info_enabled' })
  infoEnabled: boolean;

  @Column({ default: true, name: 'success_enabled' })
  successEnabled: boolean;

  @Column({ default: true, name: 'error_enabled' })
  errorEnabled: boolean;
}
