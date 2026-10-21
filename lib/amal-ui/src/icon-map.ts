/** React-free central icon map (safe to import from non-UI modules such as route tables). */
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Bell, Building2, CalendarDays, CalendarPlus, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, CircleCheck, CircleHelp, Clock, CloudUpload, Code2, Copy, Eye, FileClock, FileUp, Filter, Globe2, Handshake, IdCard, Info, LayoutGrid,
  List, ListOrdered, LogIn, LogOut, MessageSquareText, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Printer, RefreshCcw, ScrollText, Search, ShieldAlert,
  ShieldCheck, ShieldOff, Stethoscope, Table2, TrendingDown, TrendingUp, Undo2, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';

/** The one central icon map. Every icon in the product comes from here (lucide-react, stroke 1.75). */
export const AmalIcons = {
  today: CalendarDays, week: CalendarRange, newBooking: CalendarPlus, patients: Search, consent: ShieldCheck, sync: RefreshCcw,
  waitlist: ListOrdered, daySheet: Printer, myDay: Stethoscope, networkSearch: Globe2, patientCard: IdCard, privacy: ShieldCheck,
  messages: MessageSquareText, kpi: BarChart3, networkHealth: Activity, users: Users, clinics: Building2, changeLog: ScrollText,
  accessLog: FileClock, developer: Code2, import: FileUp, adoption: Handshake, duplicates: Copy,
  bell: Bell, help: CircleHelp, more: MoreHorizontal, search: Search, filter: Filter, close: X, check: Check, info: Info,
  success: CircleCheck, warning: AlertTriangle, danger: AlertTriangle, clock: Clock, cloud: CloudUpload, eye: Eye, user: UserRound,
  shield: ShieldCheck, shieldOff: ShieldOff, alert: ShieldAlert, trendUp: TrendingUp, trendDown: TrendingDown, tableView: Table2,
  cardView: LayoutGrid, list: List, chevronDown: ChevronDown, undo: Undo2,
  // Directional icons: mirrored in RTL.
  chevronNext: ChevronRight, chevronPrev: ChevronLeft, arrowNext: ArrowRight, arrowBack: ArrowLeft, logIn: LogIn, logOut: LogOut,
  collapse: PanelLeftClose, expand: PanelLeftOpen, first: ChevronsLeft, last: ChevronsRight,
} satisfies Record<string, LucideIcon>;
export type AmalIconName = keyof typeof AmalIcons;

/** Icons whose meaning is a direction; they mirror in RTL. Everything else never mirrors. */
export const DIRECTIONAL_ICONS: ReadonlySet<AmalIconName> = new Set<AmalIconName>(['chevronNext', 'chevronPrev', 'arrowNext', 'arrowBack', 'logIn', 'logOut', 'collapse', 'expand', 'first', 'last', 'undo']);


/** Section accents (icon chips and small highlights only; never status). */
export type AmalSection = 'reception' | 'patients' | 'network' | 'admin';
