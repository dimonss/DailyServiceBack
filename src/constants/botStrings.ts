export const TELL_ME_THE_STATUS_STICKER = 'CAACAgIAAxkBAAEGf_1mfrmbZRQgJ4sre7iMBAxfyYVBhQACZSEAAsSG2UoDAfCiYhiOzTUE';
export const ZERO_BUGS_STICKER = 'CAACAgIAAxkBAAEGhFtmf-2QK7Dr4fFkKZYclPTwNqNXdQACpycAAi9byEkPG6sI9a5SpzUE';

export const SAVELY_STICKER_1 = 'CAACAgIAAxkBAAEMgBdmljdpu4JZDA0qmg7xnpuIKvdzzAACESoAAukbUEhtyxtqeXn6yDUE';
export const SAVELY_STICKER_2 = 'CAACAgIAAxkBAAEMgBVmljdioY1z5WcoQ-N9s-f1DrJKyQAC4S0AArodmUoBJlrrMUby5jUE';
export const SAVELY_STICKER_3 = 'CAACAgIAAxkBAAEMgBNmljdh4g1klKryscSjSurWve1ZegACISUAAiy2mEqKv5xkEhUvMDUE';
export const SAVELY_STICKER_4 = 'CAACAgIAAxkBAAEMgBFmljdcwcW67FXULdSNShpRVWXL8QACpzQAAm1CgUvvw8wpDLtjJDUE';

export const COMMAND = {
  START: '/start',
  INIT: '/init',
  INFO: '/info',
  GROUP: '/group',
  CHAT_ID: '/chat_id',
  REMIND: '/remind',
  REMIND_PRIVATE: '/remind_private',
  TEG_ALL: '/teg_all',
  BUG_ON_PROD: '/bug_on_prod',
  BUG_ON_PRE_PROD: '/bug_on_pre_prod',
  EXPORT_XLSX: '/export_xlsx',
  EXPORT_XLSX_MONTH: '/export_xlsx_month',
  EXPORT_XLSX_WEEK: '/export_xlsx_week',
  EDIT_DAILY: '/edit_daily',
  DELETE_DAILY: '/delete_daily',
  LINK: '/link',
  UNLINK: '/unlink',
  HELP: '/help',
} as const;

export const tgBotDisplayCommands = [
  { command: 'start', description: 'Запустить бота / инструкция' },
  { command: 'info', description: 'Информация о дейлике (в группе — сводка)' },
  { command: 'edit_daily', description: 'Редактировать сегодняшний дейлик' },
  { command: 'delete_daily', description: 'Удалить сегодняшний дейлик' },
  { command: 'group', description: 'Выбрать активную группу для сдачи дейлика' },
  { command: 'init', description: 'Инициализировать бота в этой группе' },
  { command: 'remind', description: 'Тегнуть всех, кто не написал дейлик' },
  { command: 'remind_private', description: 'Отписать в личку всем, кто не написал дейлик' },
  { command: 'teg_all', description: 'Тегнуть всех участников команды' },
  { command: 'bug_on_prod', description: 'Баг на проде!!!' },
  { command: 'bug_on_pre_prod', description: 'Баг на препроде!!!' },
  { command: 'export_xlsx', description: 'Экспорт XLSX файла (за всё время)' },
  { command: 'export_xlsx_month', description: 'Экспорт XLSX за последний месяц' },
  { command: 'export_xlsx_week', description: 'Экспорт XLSX за последнюю неделю' },
  { command: 'chat_id', description: 'Узнать ID чата / топика' },
];

export const CALLBACK_ACTIONS = {
  EDIT_DAILY: 'action_edit_daily',
  DELETE_DAILY: 'action_delete_daily',
  EDIT_YESTERDAY: 'edit_part_yesterday',
  EDIT_TODAY: 'edit_part_today',
  EDIT_BOTH: 'edit_part_both',
  EDIT_CANCEL: 'edit_part_cancel',
  SELECT_GROUP_PREFIX: 'select_group:',
} as const;

export const strings = {
  introductory_instructions:
    'Пиши здесь что делал и будешь делать. Без воды! :) \nСначала напиши только то, что уже сделал. Одним сообщением.',
  error_msg: 'Возникла ошибка, попробуй позже',
  command_not_available: 'Вам не доступна эта команда',
  ups: 'Упс 😯. Что то пошло не так',
  great_Now_write_what_you_will_do: 'Отлично! Теперь напиши что будешь делать.',
  super_your_daily_has_been_recorded: 'Супер! Твой дейлик записан.',
  didnt_do_anything: 'Ничего не сделал',
  it_seems_you_already_posted_here_today: 'Кажется ты уже отписывал сегодня сюда 🤨',
  and_it_wont_be_possible_to_change_everything: 'А все уже поменять дейлик не получится 😛',
  did_you_do_anything_else: 'Ещё что то сделал? 🤔',
  post_on_this_topic_tomorrow: 'Отпиши по этой теме завтра 🥱',
  haven_t_written_anything_yet_today: 'Сегодня еще ничего не писал',
  empty: 'Пусто',
  do_you_think_messages_appear_here_on_their_own:
    'Думаешь сообщения сами тут появляются? \nИх нужно писать!',
  it_seems_you_haven_t_posted_a_message_today_yet:
    'Кажется вы еще не оставляли дейлик сегодня',
  send_a_message_and_it_will_be_added_here: 'Отправь сообщение и оно добавится сюда',
  soLittle: 'Так мало?🧐 \nНапиши побольше текста.\nА то стыдно...',
  soLong: 'К чему многословность?🧐 \nНапиши короче. \nА то читать устану...',
  it_seems_no_one_has_posted_any_tasks_today:
    'Кажется на сегодня никто не отписал по задачам',
  everybody_put_the_bolt: 'Все положили болт',
  is_empty_everyone_s_still_sleeping: 'Пусто... Все еще спят... 😴',
  congratulation: 'Поздравляю товарищи! Все заполнили дейлик вовремя',
  please_write_down_the_daily: 'Отпиши дейлик плс',
  daily: 'Дейлик!!!',
  wakeup: 'Проснись и пой!',
  work_is_not_wolf: 'Работа не волк... Работа ворк... А волк это гулять...',
  write_anything: 'Черкани ченить',
  you_are_not_in_the_system:
    'Вас нет в списке участников ни одной группы. Попросите администратора вашей команды добавить ваш @username через веб-интерфейс или создайте свою группу.',
  you_do_not_have_access_to_this_bot: 'У вас нет доступа к данному боту в этой группе',
  can_only_be_used_in_groups: 'Можно использовать только в группах',
  bugOnProd: 'Баг на проде!!!',
  bugOnPreProd: 'Баг на препроде!!!',
  daily_deleted_successfully: 'Дейлик успешно удален! Теперь можешь написать новый.',
  no_daily_to_delete: 'У тебя нет дейлика для удаления сегодня.',
  cannot_delete_after_report: 'Нельзя удалить дейлик после отправки отчета в группу.',
  cannot_edit_after_report: 'Нельзя редактировать дейлик после отправки отчета в группу.',
  no_daily_to_edit: 'У тебя нет дейлика для редактирования сегодня.',
  edit_select_part: 'Выбери, что именно ты хочешь изменить:',
  edit_enter_yesterday: '📝 Отправь новый текст для <b>«Что делал»</b> (одним сообщением):',
  edit_enter_today: '📝 Отправь новый текст для <b>«Что буду делать»</b> (одним сообщением):',
  edit_both_step1: '🔄 <b>Шаг 1 из 2:</b> Отправь новый текст для <b>«Что делал»</b>:',
  edit_both_step2: '🔄 <b>Шаг 2 из 2:</b> Отлично! Теперь отправь новый текст для <b>«Что буду делать»</b>:',
  edit_yesterday_success: 'Раздел «Что делал» успешно обновлен! ✅',
  edit_today_success: 'Раздел «Что буду делать» успешно обновлен! ✅',
  edit_both_success: 'Дейлик успешно обновлен! ✅',
  edit_cancelled: 'Редактирование отменено.',
  daily_already_submitted_with_actions:
    'Ты уже заполнил дейлик на сегодня.\nЕсли хочешь внести изменения, нажми кнопку ниже или используй команду /edit_daily.',
};

const pickRandom = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

export const genRandomErrorMessageForCompletedDaily = () =>
  pickRandom([
    strings.it_seems_you_already_posted_here_today,
    strings.and_it_wont_be_possible_to_change_everything,
    strings.did_you_do_anything_else,
    strings.post_on_this_topic_tomorrow,
  ]);

export const genRandomErrorMessageForPrivateEmptyDaily = () =>
  pickRandom([
    strings.haven_t_written_anything_yet_today,
    strings.empty,
    strings.do_you_think_messages_appear_here_on_their_own,
    strings.it_seems_you_haven_t_posted_a_message_today_yet,
  ]);

export const getRandomErrorMessageForPublicEmptyDaily = () =>
  pickRandom([
    strings.it_seems_no_one_has_posted_any_tasks_today,
    strings.everybody_put_the_bolt,
    strings.is_empty_everyone_s_still_sleeping,
  ]);

export const getRandomRequestMessageForPrivateEmptyDaily = () =>
  pickRandom([
    strings.please_write_down_the_daily,
    strings.daily,
    strings.wakeup,
    strings.work_is_not_wolf,
    strings.write_anything,
  ]);

export const getRandomSavelysSticker = () =>
  pickRandom([SAVELY_STICKER_1, SAVELY_STICKER_2, SAVELY_STICKER_3, SAVELY_STICKER_4]);
