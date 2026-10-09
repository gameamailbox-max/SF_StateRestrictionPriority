/*:
 * @target MZ
 * @plugindesc Ver1.0.0 検証版：行動制約による自己解除防止と行動不能ステートの優先度制御
 * @author 巣ごもり梟
 * @help
 * SF_StateRestrictionPriority_Ver1 Ver1.0.0 第5検証版
 *
 * 行動制約によって解除がONのステートが、自身の付与時に即座に
 * 解除される問題を防ぎます。
 *
 * 行動制約「行動できない」(restriction=4) のステート同士では、
 * 新規ステートの優先度が既存の最大優先度以下なら付与を拒否します。
 * 同じステートの再付与は許可します。
 * 新規ステートの優先度が高い場合、既存の行動不能ステートのうち
 * 「行動制約によって解除」がONのものだけを解除します。
 *
 * 通常の行動制約では現在のTPBチャージ値を維持します。
 * 戦闘不能時のみCTを0に初期化し、復帰後は0から再開します。
 * <CTOverwrite>による上書き処理は別プラグインに委ねます。
 *
 * 通常ステートは、行動制約が新たに発生した場合に限り、
 * 標準どおり「行動制約によって解除」を適用します。
 *
 * プラグイン管理画面では、他のステート処理系プラグインとの
 * 競合を避けるため、可能な限り下方に配置してください。
 */
(() => {
    "use strict";
    const isCannotMove = state => !!state && state.restriction === 4;

    // 戦闘不能ステートを新規追加した直後にCTを初期化する。
    // HP減少・イベントによる直接付与の両経路に対応。
    const _addNewState = Game_BattlerBase.prototype.addNewState;
    Game_BattlerBase.prototype.addNewState = function(stateId) {
        const wasDead = this.isDead();
        _addNewState.call(this, stateId);
        if (stateId === this.deathStateId() && !wasDead && this.isDead() && this.clearTpbChargeTime) {
            this.clearTpbChargeTime();
        }
    };

    const _addState = Game_Battler.prototype.addState;
    Game_Battler.prototype.addState = function(stateId) {
        const incoming = $dataStates[stateId];
        if (stateId === this.deathStateId()) {
            const wasDead = this.isDead();
            const result = _addState.call(this, stateId);
            // addNewState内で初期化できない構成でも、付与完了後に確実に処理する。
            if (!wasDead && this.isDead()) {
                this.clearTpbChargeTime();
            }
            return result;
        }
        if (!incoming || !isCannotMove(incoming) || this.isStateAffected(stateId)) {
            return _addState.call(this, stateId);
        }
        const existing = this.states().filter(isCannotMove);
        if (existing.some(state => state.priority >= incoming.priority)) {
            return;
        }
        const wasAffected = this.isStateAffected(stateId);
        this._sfRestrictionIncomingStateId = stateId;
        try {
            _addState.call(this, stateId);
        } finally {
            delete this._sfRestrictionIncomingStateId;
        }
        if (!wasAffected && this.isStateAffected(stateId)) {
            for (const state of existing) {
                if (state.removeByRestriction && this.isStateAffected(state.id)) {
                    this.removeState(state.id);
                }
            }
        }
    };

    const _isStateRestrict = Game_Battler.prototype.isStateRestrict;
    Game_Battler.prototype.isStateRestrict = function(stateId) {
        // 行動不能ステートは優先度比較で制御するため標準の拒否を回避
        if (isCannotMove($dataStates[stateId])) return false;
        return _isStateRestrict.call(this, stateId);
    };

    Game_Battler.prototype.onRestrict = function() {
        Game_BattlerBase.prototype.onRestrict.call(this);
        // CT値とTPB状態は維持する（行動制約中の進行制御は他に委ねる）
        this.clearActions();
        const incomingId = this._sfRestrictionIncomingStateId;
        for (const state of [...this.states()]) {
            if (state.id !== incomingId && state.removeByRestriction && !isCannotMove(state)) {
                this.removeState(state.id);
            }
        }
    };
})();
