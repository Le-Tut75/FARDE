# Farde

Ta collection Pokémon en ligne, sur ordinateur et téléphone, avec les fonctions premium :

- **Cartes illimitées**, en français, anglais, japonais, allemand, italien et espagnol (catalogue TCGdex)
- **Cotes Cardmarket mises à jour chaque matin**, même quand l'app est fermée, avec **historique** par carte
- **Produits scellés cotés automatiquement** : displays, ETB, coffrets, blisters (~5 000 produits Cardmarket)
- **Plus-value** sur chaque ligne et sur tout le portefeuille, courbe d'évolution jour par jour
- **Import de ton Google Sheets / Excel / CSV** avec reconnaissance automatique des cartes
- Fardes virtuelles (3×3, 4×3, 4×4), complétion de séries, wishlist avec prix cible et **alertes Telegram**
- Export CSV, sauvegarde complète, consultation hors ligne, installable comme une app sur ton téléphone

**Coût : 0 €.** Tout tourne sur les offres gratuites de GitHub et Supabase.

---

## Installation (environ 30 minutes, une seule fois)

Tu vas créer deux comptes gratuits :

- **Supabase** : la base de données qui stocke ta collection
- **GitHub** : héberge le site et lance la mise à jour des prix chaque matin

Aucune ligne de code à écrire : tu copies, tu colles, tu cliques.

### Étape 1 : créer la base de données (Supabase)

1. Va sur [supabase.com](https://supabase.com) › **Start your project** et crée un compte (le plus simple : « Continue with GitHub » après l'étape 4, ou avec ton e-mail).
2. Clique sur **New project**.
   - **Name** : `farde`
   - **Database Password** : clique sur « Generate a password » et garde-le quelque part (tu n'en auras normalement pas besoin)
   - **Region** : *West EU (Paris)*
   - Clique sur **Create new project** et attends 1 à 2 minutes.
3. Dans le menu de gauche, ouvre **SQL Editor** › **New query**.
4. Ouvre le fichier `supabase/schema.sql` de ce dossier avec le Bloc-notes (ou TextEdit), copie **tout** son contenu, colle-le dans Supabase et clique sur **Run**.
   - Tu dois voir « Success. No rows returned ». Tu peux relancer ce script sans risque.

### Étape 2 : récupérer tes 3 clés Supabase

Garde ces 3 valeurs dans une note, tu en auras besoin à l'étape 4.

1. **Project Settings** (roue crantée en bas à gauche) › **Data API** : copie le **Project URL** (ressemble à `https://abcdefgh.supabase.co`).
2. **Project Settings** › **API Keys** :
   - copie la **Publishable key** (commence par `sb_publishable_`). Si ton projet affiche plutôt l'onglet « Legacy API keys », prends la clé **anon public**.
   - copie la **Secret key** (commence par `sb_secret_`, bouton « Reveal »). Ou, en version « Legacy », la clé **service_role**.

> ⚠️ La **Secret key** donne un accès total à ta base. Ne la mets jamais dans un fichier ni dans un message : seulement dans le coffre-fort de GitHub (étape 4).
> La Publishable key, elle, est faite pour être publique : la sécurité de la base empêche quiconque de lire tes données.

### Étape 3 : mettre le code sur GitHub

1. Crée un compte sur [github.com](https://github.com) (gratuit).
2. En haut à droite, **+** › **New repository**.
   - **Repository name** : `farde`
   - Coche **Public** (obligatoire pour héberger le site gratuitement ; seul le code est public, jamais tes données)
   - Clique sur **Create repository**.
3. Sur la page qui s'affiche, clique sur le lien **uploading an existing file**.
4. Dézippe le dossier `farde` sur ton ordinateur, ouvre-le, sélectionne **tout son contenu** et glisse-le dans la page GitHub.
   - **Sur Mac**, le dossier `.github` est caché : dans le Finder, appuie sur `Cmd` + `Maj` + `.` pour l'afficher avant de tout sélectionner.
   - Clique sur **Commit changes** en bas de la page.
5. Vérifie que ton dépôt contient bien les dossiers `.github`, `app`, `job` et `supabase`. S'il manque `.github`, regarde la section *Problèmes fréquents*, plus bas.

### Étape 4 : donner les clés à GitHub

Dans ton dépôt GitHub : **Settings** › **Secrets and variables** › **Actions**.

1. Onglet **Variables** › **New repository variable**, à faire deux fois :

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | ton Project URL (`https://….supabase.co`) |
   | `SUPABASE_ANON_KEY` | ta Publishable key (ou anon) |

2. Onglet **Secrets** › **New repository secret** :

   | Name | Secret |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | ta Secret key (ou service_role) |

Les noms doivent être écrits exactement comme ci-dessus.

### Étape 5 : publier le site

1. **Settings** › **Pages** › dans **Source**, choisis **GitHub Actions**.
2. Onglet **Actions** du dépôt. Si GitHub affiche un bouton « I understand my workflows, go ahead and enable them », clique dessus.
3. À gauche, clique sur **Publier le site** › bouton **Run workflow** › **Run workflow**.
4. Attends la coche verte (environ 1 minute). Ton site est en ligne à l'adresse :
   **`https://TON-PSEUDO-GITHUB.github.io/farde/`**

### Étape 6 : créer ton compte

1. Dans Supabase : **Authentication** › **Sign In / Providers** › **Email** : désactive **Confirm email** et enregistre.
   Pour une instance perso, c'est plus simple : pas d'e-mail de confirmation à attendre, qui finit souvent en spam.
2. Ouvre ton site, clique sur **Créer un compte**, choisis ton e-mail et un mot de passe (8 caractères minimum). Tu es connecté directement.
3. **Ferme la porte derrière toi** : toujours dans **Authentication** › **Sign In / Providers**, désactive **Allow new users to sign up** et enregistre.
   Personne d'autre ne pourra créer de compte sur ton instance. Ton compte, lui, continue de fonctionner.

### Étape 7 : lancer la première mise à jour des prix

1. GitHub › onglet **Actions** › **Prix quotidiens** › **Run workflow**.
2. Attends la coche verte (2 à 5 minutes la première fois).
3. Dans l'app, onglet **Réglages** › « Mise à jour des cotes » doit afficher **Réussie**.

Ensuite, c'est automatique : **chaque matin vers 6 h**, les cotes de toutes tes cartes et de tous tes scellés sont mises à jour, l'historique est enregistré et la courbe de ton portefeuille avance d'un point. Tu n'as rien à faire.

### Étape 8 : l'installer sur ton téléphone

- **iPhone** (Safari) : ouvre le site › bouton Partager › **Sur l'écran d'accueil**.
- **Android** (Chrome) : ouvre le site › menu ⋮ › **Installer l'application**.

L'app s'ouvre alors en plein écran comme une vraie app, et reste consultable sans réseau (en salon, en boutique).

---

## Importer ton Google Sheets

Onglet **Import**. Trois méthodes :

1. **Copier-coller (la plus simple)** : dans Google Sheets, sélectionne tes cellules titres compris, `Ctrl+C`, colle-les dans la zone de texte.
2. **Fichier** : *Fichier › Télécharger › Microsoft Excel (.xlsx)* ou *CSV*, puis glisse le fichier dans l'app.
3. **Lien** : partage la feuille (« Tous les utilisateurs disposant du lien ») et colle le lien.

L'app reconnaît automatiquement les colonnes (nom, numéro, série, langue, état, quantité, prix et date d'achat, variante, gradation, notes). Tu peux corriger chaque correspondance.

Pour chaque ligne, elle cherche la carte exacte :

- **Numéro « 199/165 »** : retrouve la série même si tu ne l'as pas écrite (165 cartes = 151).
- **Série** : accepte le nom français, le nom anglais (« Scarlet & Violet 151 ») ou le code officiel (MEW, PAF, SSP…).
- **Nom** : « Dracaufeu ex » et « Dracaufeu-ex » sont identiques, les accents manquants sont tolérés.
- **Dans le nom** : « PSA 10 » devient une carte gradée, « reverse » ou « holo » devient la variante.

Tu vérifies ensuite les cas douteux :

- **Reconnue** : la carte est importée telle quelle.
- **À vérifier** : la carte proposée est importée, jette juste un œil.
- **À choisir** : plusieurs cartes possibles, clique sur la bonne.
- **Introuvable** : choisis la carte à la main, ou ignore la ligne.

À la fin, tu peux télécharger les lignes non importées pour les corriger.

**Astuce** : l'export CSV de l'onglet Collection se réimporte tel quel. Il sert aussi de sauvegarde.

---

## Alertes Telegram (facultatif, 5 minutes)

Reçois un message quand une carte de ta wishlist passe sous ton prix cible.

1. Dans Telegram, écris à **@BotFather** › `/newbot` › choisis un nom. Il te donne un **token** (`123456:ABC…`).
2. GitHub › Settings › Secrets and variables › Actions › **Secrets** › New repository secret :
   - **Name** : `TELEGRAM_BOT_TOKEN`
   - **Secret** : le token
3. Ouvre ton nouveau bot dans Telegram et envoie-lui `/start`.
4. Écris à **@userinfobot** : il te répond ton **Id** (un nombre).
5. Dans l'app : **Réglages** › Alertes Telegram › colle ce nombre › Enregistrer.
6. Dans la **Wishlist**, mets un prix cible sur tes cartes.

Une alerte est envoyée le matin, au plus une fois tous les 3 jours par carte.

---

## Bon à savoir

- **D'où viennent les cotes ?**
  - Cartes : TCGdex, qui reprend la cote Cardmarket du jour.
  - Scellés et cartes manquantes chez TCGdex : directement le fichier public quotidien de Cardmarket.
  - La cote de référence se choisit dans Réglages (tendance, moyenne 30 jours…).
- **Langues** : Cardmarket donne une cote commune aux langues européennes. Pour une carte japonaise (souvent sans cote) ou pour coter différemment une version FR, saisis une **cote manuelle** sur la ligne.
- **État** : la cote correspond à du Near Mint. Un coefficient s'applique selon l'état (EX = 85 %, etc., modifiable dans Réglages).
- **Cartes gradées** : la cote affichée est celle de la carte non gradée. Utilise le bouton **Ventes conclues eBay** de la fiche pour trouver le prix d'une PSA 10, puis mets-le en cote manuelle.
- **Tes données** sont dans ta propre base Supabase : personne d'autre n'y a accès, pas même le code public.

### Ce qu'il n'y a pas (par rapport à PokéItem)

- **Scan de cartes** à l'appareil photo
- **One Piece**, Pokédex, place de marché

---

## Problèmes fréquents

**« L'app n'est pas encore reliée à ta base de données »**
Les variables `SUPABASE_URL` / `SUPABASE_ANON_KEY` manquent ou sont mal nommées (étape 4). Corrige-les, puis relance **Actions › Publier le site › Run workflow**.

**Le dossier `.github` n'a pas été envoyé**
Dans GitHub : **Add file › Create new file**.
- Nom du fichier : `.github/workflows/prix-quotidiens.yml`
- Contenu : celui du fichier du même nom dans ton dossier.
- **Commit**.

Refais la même chose pour `.github/workflows/publier-site.yml`.

**Une tâche GitHub est en rouge**
Clique dessus pour lire le message. Les causes les plus courantes :
- secret `SUPABASE_SERVICE_ROLE_KEY` absent ou mal copié (espace en trop) ;
- script SQL de l'étape 1 pas lancé.

**« Adresse pas encore confirmée » à la connexion**
Dans Supabase : **Authentication** › **Users** › clique sur ton e-mail › **Confirm email** (ou supprime l'utilisateur et recrée le compte après avoir désactivé « Confirm email », étape 6).

**« La création de comptes est désactivée »**
C'est l'étape 6.3 : réactive temporairement « Allow new users to sign up » si tu dois recréer ton compte.

**« Projet en pause » dans Supabase**
Les projets gratuits sans aucune activité pendant 7 jours sont mis en pause. La mise à jour quotidienne évite normalement ce cas. Si ça arrive, clique sur **Restore project** : rien n'est perdu.

**La mise à jour du matin ne tourne plus**
GitHub suspend les tâches planifiées d'un dépôt inactif depuis 60 jours. La tâche fait elle-même un petit enregistrement tous les 45 jours pour l'éviter. Si besoin : **Actions › Prix quotidiens › Enable workflow**.

**Mettre à jour l'app plus tard**
Remplace les fichiers concernés dans GitHub (*Add file › Upload files*). Le site se republie tout seul en une minute.

---

## Structure du dossier

```
app/                    le site (HTML, CSS, JavaScript, sans étape de compilation)
  js/valuation.js       calcul des valeurs et plus-values (partagé avec la tâche du matin)
  js/match.js           reconnaissance des cartes à l'import
  js/vendor/            bibliothèques Supabase et SheetJS (lecture Excel), incluses en local
job/update-prices.mjs   mise à jour quotidienne des cotes
supabase/schema.sql     structure et sécurité de la base
.github/workflows/      publication du site + tâche quotidienne
```

Projet indépendant, non affilié à Nintendo, The Pokémon Company, Cardmarket ou PokéItem.
Données de cartes : [TCGdex](https://tcgdex.dev). Cotes : [Cardmarket](https://www.cardmarket.com).
