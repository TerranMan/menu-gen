import { decodeBackup, encodeBackup, loadPreviousBackup, loadSavedState, restoreBackup, snapshot } from './store.js';
import { localDateKey } from './week.js';

const backupDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

export function backups() {
  return {
    backupBusy: false,
    backupMessage: '',
    backupError: false,
    backupPreview: null,
    hasPreviousBackup: false,

    setBackupMessage(message = '', error = false) {
      this.backupMessage = message;
      this.backupError = error;
    },

    async openBackups() {
      this.backupPreview = null;
      this.setBackupMessage();
      this.$refs.backupFile.value = '';
      this.hasPreviousBackup = false;
      this.$refs.backupDialog.showModal();
      this.hasPreviousBackup = Boolean(await loadPreviousBackup());
    },

    async downloadBackup() {
      if (this.backupBusy || this.savePending) return;
      this.backupBusy = true;
      this.setBackupMessage();
      try {
        const state = await loadSavedState();
        if (!state) {
          this.setBackupMessage('Не удалось прочитать сохранённые данные.', true);
          return;
        }
        const blob = new Blob([encodeBackup(state)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = `menu-gen-${localDateKey(new Date())}.json`;
          this.$refs.backupDialog.append(link);
          link.click();
          link.remove();
          this.setBackupMessage('Скачивание резервной копии запущено.');
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }
      } catch {
        this.setBackupMessage('Не удалось скачать резервную копию.', true);
      } finally {
        this.backupBusy = false;
      }
    },

    async previewBackup(source, label) {
      if (this.backupBusy || this.savePending) return;
      this.backupBusy = true;
      this.backupPreview = null;
      this.setBackupMessage();
      try {
        const data = await source();
        if (!data) {
          this.setBackupMessage('Копия повреждена или имеет неподдерживаемый формат.', true);
          return;
        }
        if (Object.values(data.state.week).some((entries) =>
          entries.some(({ dishId }) => !this.dishById(dishId)))) {
          this.setBackupMessage('В плане есть блюда из другой версии меню. Обновите приложение и выберите копию заново.', true);
          return;
        }
        const expected = await loadSavedState();
        if (!expected) {
          this.setBackupMessage('Не удалось прочитать текущие данные для восстановления.', true);
          return;
        }
        this.backupPreview = { ...data, expected, label };
      } catch {
        this.setBackupMessage('Не удалось открыть файл резервной копии.', true);
      } finally {
        this.backupBusy = false;
      }
    },

    selectBackupFile(input) {
      const [file] = input.files;
      input.value = '';
      if (file) return this.previewBackup(async () => decodeBackup(await file.text()), file.name);
    },

    previewPreviousBackup() {
      return this.previewBackup(loadPreviousBackup, 'Данные перед последним восстановлением');
    },

    backupPreviewDate() {
      return backupDate.format(new Date(this.backupPreview.savedAt));
    },

    backupPreviewWeek() {
      const { week, weekStart } = this.backupPreview.state;
      const meals = Object.keys(week).length;
      return meals ? `${this.weekLabel(weekStart)} · приёмов ${meals}` : 'Пустой план';
    },

    async applyBackup() {
      if (!this.backupPreview || this.backupBusy || this.savePending) return;
      const { expected, state: replacement } = this.backupPreview;
      const dialog = this.$refs.backupDialog;
      const status = dialog.querySelector('[role="status"]');
      this.backupBusy = true;
      this.savePending++;
      this.editRevision++;
      this.setBackupMessage();
      try {
        const { state, error, changed } = await restoreBackup(snapshot(expected), snapshot(replacement));
        if (error === 'conflict') {
          this.backupPreview = null;
          this.setBackupMessage('Данные изменились в другой вкладке. Выберите копию заново и проверьте предпросмотр.', true);
          this.storageChanged = true;
          return;
        }
        if (error) {
          this.setBackupMessage('Не удалось восстановить копию. Текущие данные по-прежнему доступны.', true);
          return;
        }
        this.applySavedState(state);
        this.showView(state.view);
        this.dayId = this.days[0].id;
        this.expanded = {};
        this.copyMessage = '';
        this.copyText = '';
        this.plannerMessage = '';
        this.storageMessage = '';
        this.editingPrices = false;
        this.backupPreview = null;
        if (changed) {
          this.hasPreviousBackup = true;
          this.storageChannel?.postMessage('saved');
          this.setBackupMessage('Копия восстановлена. Прежние данные доступны в этом окне.');
        } else {
          this.setBackupMessage('Копия совпадает с текущими данными.');
        }
      } finally {
        this.savePending--;
        this.backupBusy = false;
        if (this.storageChanged) this.syncStorage();
        this.$nextTick(() => {
          if (dialog.open) status.focus();
        });
      }
    },
  };
}
