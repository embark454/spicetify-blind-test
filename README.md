# Blind Test — version 0.3

Un jeu solo en français intégré à Spotify avec Spicetify. Compose une sélection avec tes playlists, albums ou titres likés et retrouve le titre et l’artiste en quelques secondes.

Prototype expérimental, conçu et vérifié avec Spicetify 2.45.1 sous Windows. Ce dépôt contient le code du jeu et ses tests ; ce n’est pas une application officielle Spotify.

## Jouer

1. Fais un **clic droit sur un album ou une playlist → Jouer au blind test**. Tu peux aussi ouvrir **Blind Test**, coller entre 1 et 5 liens de playlists ou d’albums, ou cliquer sur **♥ Mes titres likés**. Ce bouton remplace la sélection actuelle par tes favoris, sans lancer de lecture.
2. Choisis la difficulté **Facile** ou **Difficile**, le mode, le nombre de manches et le passage : début du morceau ou passage au hasard.
3. Lance la partie puis clique sur **Écouter**. Saisis le titre, l’artiste, ou les deux.
4. Consulte ton résultat, relance une sélection ou rejoue uniquement les morceaux à réviser.

### Facile ou Difficile

- **Facile** : une liste apparaît dès que tu commences à taper le titre ou l’artiste. Jusqu’à 8 propositions issues de toute ta sélection, filtrées sans tenir compte des accents ni des majuscules. Clique sur une proposition, ou utilise les flèches puis Entrée. Cela remplit uniquement le champ choisi ; clique ensuite sur **Valider ma réponse**. Échap ferme la liste sans quitter la partie. Tu peux aussi écrire librement.
- **Difficile** : aucune liste de suggestions. La tolérance aux petites fautes reste la même.

Ces niveaux fonctionnent en Défi et en Entraînement. Les points suivent les mêmes règles, avec des records distincts pour chaque difficulté. Les anciens records sont conservés en Difficile, qui correspond au fonctionnement précédent. Le niveau choisi est mémorisé.

### Défi progressif

| Extrait | Points par réponse |
| --- | --- |
| 1 seconde | 100 |
| 2 secondes | 80 |
| 4 secondes | 60 |
| 8 secondes | 40 |
| 16 secondes | 20 |

Le titre et l’artiste rapportent des points séparément, jusqu’à **200 points par morceau**. Une réponse déjà trouvée conserve ses points. Par exemple, reconnaître l’artiste à 1 seconde puis le titre à 8 secondes rapporte 100 + 40 = 140 points.

Une mauvaise réponse fait passer au palier suivant ; au dernier palier elle révèle la solution. Tu peux aussi demander plus de musique. Le passage commence toujours au même endroit au fil des paliers. Réécouter le palier actuel est gratuit. Une réponse correcte accompagnée d’un champ vide permet de chercher la réponse restante au même palier.

### Entraînement

Choisis un extrait de 5, 10, 15 ou 20 secondes. Chaque réponse correcte vaut 1 point, les essais sont libres. Après la révélation, tu peux accepter manuellement une réponse que tu avais saisie : la session est alors indiquée **hors record**. Le bouton **Rejouer mes erreurs** utilise ce mode, avec 16 secondes pour réviser un défi, et reste toujours hors record.

## Sélection, réponses et records

- Jusqu’à 5 sources mélangées, playlists, albums et titres likés ; les doublons d’URI sont retirés. Pour inclure tes favoris dans un mélange, ajoute `spotify:collection:tracks` sur une ligne. Le tirage privilégie les morceaux absents des 100 derniers morceaux de parties terminées, puis cherche à varier les artistes. Une petite sélection peut nécessairement se répéter.
- Accents, casse et ponctuation sont ignorés. Certaines petites fautes sur les noms longs, les crédits d’artistes participants et les suffixes courants de remaster/live sont tolérés. La correction reste imparfaite.
- Réglages et records sont enregistrés localement. Un record dépend des sources, de la difficulté, du mode, du passage, de la durée en entraînement et du nombre réel de manches. Modifier le contenu d’une playlist ne crée pas une nouvelle catégorie de record.
- Le bilan présente les duos trouvés à 1 seconde en défi, les artistes reconnus et les morceaux à réviser. Les parties en cours ne sont pas reprises après fermeture.

## Lecture et masquage

Le jeu masque l’interface Spotify pendant la partie. Les notifications Windows, Spotify Connect et les autres appareils peuvent encore révéler les réponses. Utilise **la lecture sur cet ordinateur** pour les premiers essais.

Le volume du lecteur est temporairement mis à zéro pendant la préparation et le positionnement de l’extrait, puis rétabli à sa valeur précédente. Le chronomètre utilise la progression signalée par Spotify. Le jeu arrête l’extrait quand on quitte ; il ne reprend pas automatiquement la musique précédente. Une défaillance prolongée du lecteur affiche une invitation à relancer Spotify.

Les fichiers locaux, podcasts et pistes inutilisables sont écartés. Le chargement accepte au maximum 10 000 titres par source, y compris les titres likés. Le défi exige des morceaux d’au moins 17 secondes. Si la sélection est trop petite, le nombre de manches diminue.

## Installer ou mettre à jour

Spicetify doit déjà être installé et fonctionner avec le client Spotify. Télécharge le dépôt (**Code → Download ZIP**) puis extrais-le. Sous Windows, exécute `INSTALLER.ps1` avec PowerShell depuis le dossier extrait. Il copie les huit fichiers de l’application dans `%APPDATA%\spicetify\CustomApps\blind-test`, ajoute le jeu sans remplacer les autres applications et lance `spicetify apply`, qui peut redémarrer Spotify.

Une sauvegarde datée de la configuration et de l’ancienne version éventuelle est conservée dans `sauvegardes`. L’archive de distribution ne contient pas ces sauvegardes personnelles.

Pour désactiver uniquement le jeu :

```powershell
spicetify config custom_apps blind-test-
spicetify apply
```

## Modifier le jeu

- `app.js` : écrans et déroulement d’une partie.
- `core.js` : tirage, variantes de réponses, suggestions, règles et calcul des points.
- `spotify.js` : chargement des playlists, albums, titres likés et contrôle des extraits.
- `storage.js` : réglages, records et historique récent local.
- `launcher.js` : entrée du menu contextuel des playlists, albums et titres likés.
- `style.css` : présentation.
- `index.js` et `manifest.json` : intégration à Spicetify.

Après modification, relancer l’installateur. Aucun serveur, compte supplémentaire, jeton personnel enregistré, service analytique ou téléchargement de morceaux n’est ajouté par le module.

### Lancer les tests

Avec Node.js 22 ou plus récent, depuis la racine du dépôt :

```console
npm test
```

Aucune dépendance à installer. Les tests du moteur, du stockage, des suggestions et de la lecture simulée fonctionnent sans Spotify. Les contrôles du module installé et du constructeur réel de Spicetify sont ignorés lorsque leurs fichiers ne sont pas présents sur la machine.

Pour signaler un bug, ouvre une issue avec les versions de Spotify et Spicetify, les étapes pour reproduire le problème et le message d’erreur. Ne joins pas de jeton de connexion, de fichier de configuration personnel ou de contenu de playlist privée.

## Vérification et limites

La suite automatisée vérifie les règles, les variantes de réponses, les suggestions sur un catalogue de 50 000 morceaux, les tirages, la séparation des records par difficulté, la conservation des anciens records, la récupération après saturation du stockage, le menu contextuel, le chargement des sources, la lecture simulée, ses annulations et le chargement du module généré par Spicetify.

Le parcours a également été vérifié dans un navigateur avec audio simulé : points conservés entre les paliers, record persistant, révision et correction hors record, mélange sans doublons, partie complète de cinq manches, erreurs de chargement, annulation, raccourci Titres likés, suggestions au clic et au clavier et absence d’aide en Difficile.

**Le son réel dans Spotify et la précision audible du palier d’une seconde restent à tester avec ton compte.** Les contrôles simulés ne les certifient pas. Le multijoueur sur téléphone, le classement public et le choix automatique du refrain ne sont pas inclus. Les interfaces internes de Spotify peuvent évoluer et nécessiter une adaptation.

Prototype non officiel. La [politique développeur Spotify](https://developer.spotify.com/policy), section III.2, interdit les jeux/quiz via sa plateforme ; Spicetify n’apporte pas d’autorisation particulière pour cet usage.

## Licence

Le code de ce projet est distribué sous [licence MIT](LICENSE). Cette licence ne donne aucun droit sur les morceaux, les marques ou le service Spotify.
