extends Node
## Bus de signaux global.
##
## Regle D.2.4 : aucun `get_node("../../..")` dans le projet. Deux entites qui
## ne se connaissent pas communiquent ici, et nulle part ailleurs. Un signal
## ajoute ici doit rester generique : si un seul appelant et un seul receveur
## existent, c'est une reference injectee qu'il faut, pas un signal global.

# --- Joueur -----------------------------------------------------------------

## PV restants apres le degat, cause pour le retour visuel et sonore.
signal player_damaged(remaining_health: int, cause: StringName)
signal player_healed(remaining_health: int)
signal player_died(cause: StringName)
signal player_respawned(checkpoint_index: int)
signal player_jumped(is_coyote: bool)
signal player_landed(fall_speed: float)
signal player_stomped_enemy(enemy_id: StringName, combo: int)

# --- Pouvoirs ---------------------------------------------------------------

signal power_acquired(power_id: StringName, slot: StringName)
signal power_activated(power_id: StringName)
signal power_expired(power_id: StringName)
signal power_charges_changed(power_id: StringName, remaining: int, maximum: int)
signal power_swapped(active_id: StringName, pocket_id: StringName)
## Emis la premiere fois qu'un pouvoir entre dans l'album (A.6.4).
signal power_discovered(power_id: StringName)

# --- Ennemis et statuts -----------------------------------------------------

signal enemy_spawned(enemy_id: StringName)
signal enemy_damaged(enemy_id: StringName, amount: int, remaining: int)
signal enemy_died(enemy_id: StringName, cause: StringName)
signal enemy_discovered(enemy_id: StringName)
signal status_applied(target: Node, status: StringName, duration: float)
signal status_removed(target: Node, status: StringName)

# --- Boss -------------------------------------------------------------------

signal boss_started(boss_id: StringName)
signal boss_phase_changed(boss_id: StringName, phase: int)
signal boss_vulnerable(boss_id: StringName, duration: float)
signal boss_invulnerable(boss_id: StringName)
signal boss_damaged(boss_id: StringName, remaining_ratio: float)
signal boss_defeated(boss_id: StringName)

# --- Niveau et progression --------------------------------------------------

signal level_loaded(world_index: int, level_index: int)
signal level_started()
signal level_completed(stars: int, elapsed_time: float)
signal checkpoint_reached(checkpoint_index: int)
signal amber_collected(total: int)
signal hidden_amber_collected(found: int, total: int)
signal crystal_obtained(world_index: int)
signal stars_changed(world_index: int, level_index: int, stars: int)

# --- Economie ---------------------------------------------------------------

signal amber_changed(amount: int)
signal shards_changed(amount: int)
signal lives_changed(amount: int)
signal purchase_made(item_id: StringName, cost: int)

# --- Interface, didacticiel et assistance -----------------------------------

signal tutorial_step_started(step_index: int)
signal tutorial_step_completed(step_index: int)
signal hint_requested(hint_id: StringName)
## Emis quand le joueur est immobile ou bloque : PIKO va montrer l'objectif.
signal player_stuck(seconds_stuck: float)
signal assist_mode_offered()
signal assist_mode_changed(enabled: bool)

# --- Systeme ----------------------------------------------------------------

signal settings_changed(section: StringName, key: StringName)
signal quality_tier_changed(tier: int)
signal game_paused(paused: bool)
signal save_completed(slot: int, success: bool)
## Demande de retour arriere (bouton materiel Android ou touche Echap).
signal back_requested()

## Emis par n'importe quel systeme pour declencher un tremblement d'ecran.
## `Settings` peut l'ignorer si le joueur a desactive l'effet.
signal screen_shake_requested(strength: float, duration: float)
## Gel d'image de quelques frames sur les coups importants (B.10).
signal hit_stop_requested(frames: int)
