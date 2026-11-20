import { aggregate, formatLine, groupShopping, priceKey, stockQuantity } from './shopping.js';

export function pantry(data, departments) {
  const ingredients = aggregate(data.categories.flatMap((category) => category.dishes))
    .filter((ingredient) => ingredient.unit !== 'по вкусу')
    .map(({ name, unit }) => ({ name, unit, key: priceKey({ name, unit }) }));
  const byKey = new Map(ingredients.map((ingredient) => [ingredient.key, ingredient]));
  return {
    stockGroups: groupShopping(ingredients, departments),
    stockKey: '',
    stockAmount: '',
    stockMessage: '',

    stockedItems() {
      return ingredients.filter(({ key }) => this.state.stock[key] > 0)
        .map((ingredient) => ({
          ...ingredient,
          text: formatLine({ ...ingredient, qty: this.state.stock[ingredient.key] }),
        }));
    },

    selectStock(key) {
      this.stockKey = key;
      this.stockAmount = this.state.stock[key] ?? '';
      this.stockMessage = '';
    },

    openStock() {
      this.selectStock('');
      this.$refs.stockDialog.showModal();
    },

    stockUnit() {
      return byKey.get(this.stockKey)?.unit ?? '';
    },

    async updateStock(key, amount) {
      const ingredient = byKey.get(key);
      if (!ingredient) return;
      const qty = stockQuantity(Number(amount), ingredient.unit);
      const stock = { ...this.state.stock };
      if (qty > 0) stock[key] = qty;
      else delete stock[key];
      const next = {
        ...this.state,
        stock,
        checked: this.validShoppingChecks('menu', stock),
        weekChecked: this.validShoppingChecks('week', stock),
      };
      if (!await this.saveState(next)) {
        this.stockMessage = 'Сохранить остаток не удалось. Попробуйте ещё раз.';
        return;
      }
      if (key === this.stockKey) this.stockAmount = qty || '';
      this.stockMessage = qty > 0 ? 'Остаток сохранён.' : 'Позиция убрана из запасов.';
    },
  };
}
