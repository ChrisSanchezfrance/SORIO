shader_type canvas_item;
// Reteinte la TENUE de SORIO selon le pouvoir actif (A.6).
//
// Pourquoi un shader plutot que 36 jeux de sprites : le personnage est
// dessine a plat par `CharacterDrawer`, donc la tunique et le pantalon sont
// deux couleurs unies exactes. Les remplacer au pixel pres coute un
// `distance()` et evite de generer 36 x 20 images — et le jour ou un 37e
// pouvoir arrive, il n'y a rien a regenerer.
//
// `modulate` ne convenait pas : il teinte TOUT, y compris la peau, les
// cheveux et l'echarpe. Or l'echarpe porte les PV (A.3) et ne doit jamais
// changer de couleur pour une autre raison.

uniform vec3 tunic_source = vec3(0.24, 0.68, 0.30);
uniform vec3 trousers_source = vec3(0.33, 0.27, 0.44);
uniform vec3 tunic_target = vec3(0.24, 0.68, 0.30);
uniform vec3 trousers_target = vec3(0.33, 0.27, 0.44);
// Marge de reconnaissance des couleurs. Les teintes de la palette sont
// suffisamment ecartees pour qu'une petite valeur suffise.
uniform float tolerance : hint_range(0.01, 0.30) = 0.06;

// Halo du pouvoir, melange par-dessus la silhouette entiere.
uniform vec3 aura_color = vec3(1.0);
uniform float aura_strength : hint_range(0.0, 1.0) = 0.0;
// Le halo ne va jamais jusqu'a effacer le personnage.
const float AURA_CEILING = 0.38;

void fragment() {
	vec4 tex = texture(TEXTURE, UV);
	if (tex.a > 0.01) {
		if (distance(tex.rgb, tunic_source) < tolerance) {
			tex.rgb = tunic_target;
		} else if (distance(tex.rgb, trousers_source) < tolerance) {
			tex.rgb = trousers_target;
		}
		tex.rgb = mix(tex.rgb, aura_color, aura_strength * AURA_CEILING);
	}
	COLOR = tex * COLOR;
}
