# Content - SuperSoftJx - SmartCrop (`plg_content_smartcrop`)

**SmartCrop** είναι ένα σύγχρονο, generic Joomla Content Plugin για τις εκδόσεις **Joomla 5.4.x** και **Joomla 6.x**, σχεδιασμένο να παρέχει ακριβές visual framing και μη-καταστροφικά metadata περικοπής (crop) για εικόνες άρθρων (`com_content.article`).

---

## 1. Τι κάνει το SmartCrop

Το SmartCrop επιτρέπει στον συντάκτη/editor ενός άρθρου να ορίζει ακριβώς ποιο τμήμα της εικόνας του άρθρου θα προβάλλεται μέσα σε ένα container συγκεκριμένου aspect ratio (προεπιλογή `4:3`).

Στο περιβάλλον επεξεργασίας του άρθρου (τόσο στο Administrator όσο και στο Frontend site editor), το SmartCrop ενσωματώνεται φυσικά στην υπάρχουσα καρτέλα **Images and Links**, προσθέτοντας κουμπί καδραρίσματος κάτω από την Εισαγωγική Εικόνα (`image_intro`) και κάτω από την Πλήρη Εικόνα (`image_fulltext`). Πατώντας το κουμπί, ανοίγει ένα εστιασμένο Bootstrap Modal με:
- **Σταθερό viewport** με το ρυθμισμένο aspect ratio (π.χ. `4:3`) και ρυθμιζόμενο μέγεθος προβολής (π.χ. 480px max width)
- **Drag / Pan** για μετακίνηση της εικόνας πίσω από το πλαίσιο
- **Zoom In / Zoom Out** κουμπιά, **Zoom Slider** (100% – 300%), Quick Zoom Presets (`100% Fit`, `125%`, `150%`, `200%`) και mouse wheel zoom
- **Αυστηρό boundary containment**: Η εικόνα καλύπτει **πάντα 100%** το viewport. Δεν μπορεί ποτέ να δημιουργηθεί κενό background
- **Reset button**: Επαναφέρει άμεσα την εικόνα σε κεντραρισμένη κάλυψη (cover) με 100% zoom
- **Κανόνα των τρίτων**: Διακριτικό πλέγμα καθοδήγησης (rule-of-thirds grid) και viewfinder γωνίες φωτογραφικής μηχανής

---

## 2. Μη-καταστροφικό Framing (Non-Destructive)

- Το SmartCrop **ΔΕΝ τροποποιεί ποτέ το αρχικό αρχείο εικόνας** (original image).
- Το αρχικό αρχείο παραμένει άθικτο στην αρχική του ανάλυση και ποιότητα στον φάκελο `images/`.

---

## 3. Χωρίς παραγωγή Cropped Files

- Το SmartCrop **ΔΕΝ δημιουργεί νέα cropped αρχεία**, thumbnails ή παραγόμενα (derivative) image files στο δίσκο.
- Αποθηκεύει αποκλειστικά και μόνο framing/crop metadata (κανονικοποιημένες συντεταγμένες).
- Η τελική εμφάνιση αποδίδεται responsive στο frontend μέσω CSS.

---

## 4. Χωρίς δικό του Database Table

- Το SmartCrop **ΔΕΝ δημιουργεί κανέναν πίνακα στη βάση δεδομένων** (δεν υπάρχει `#__smartcrop`).
- Δεν εκτελεί παρακαμπτήρια SQL queries (`INSERT`/`UPDATE`) στο `#__content`.
- Ακολουθεί 100% το εγγενές Joomla article save pipeline.

---

## 5. Αποθήκευση στο υπάρχον Article `images` JSON

Το Joomla αποθηκεύει τα metadata εικόνων του άρθρου στη στήλη `#__content.images` σε μορφή JSON.

Το SmartCrop αποθηκεύει τα δεδομένα του **μέσα στο ίδιο υπάρχον `images` JSON**, κάτω από το namespaced κλειδί `smartcrop`.

### Παράδειγμα Stored JSON:

```json
{
  "image_intro": "images/headers/banner.jpg",
  "image_intro_alt": "Εισαγωγική εικόνα άρθρου",
  "float_intro": "",
  "image_intro_caption": "",

  "image_fulltext": "",
  "image_fulltext_alt": "",
  "float_fulltext": "",
  "image_fulltext_caption": "",

  "smartcrop": {
    "version": 1,
    "profiles": {
      "default": {
        "source": "images/headers/banner.jpg",
        "ratio": {
          "width": 4,
          "height": 3
        },
        "crop": {
          "x": 0.125,
          "y": 0.083333,
          "width": 0.75,
          "height": 0.5625
        },
        "source_dimensions": {
          "width": 1600,
          "height": 1200
        }
      }
    }
  }
}
```

### Χαρακτηριστικά Αποθήκευσης:
- **Πραγματικό Nested JSON**: Αποθηκεύεται ως κανονικό JSON αντικείμενο μέσα στο `images`, **όχι ως escaped JSON string** (`"\"{\\\"version\\\"..."`).
- **Διατήρηση Υπαρχόντων Πεδίων**: Όλα τα υπάρχοντα ή μελλοντικά πεδία του `images` (`image_intro`, `image_fulltext`, alt κείμενα κ.λπ.) διατηρούνται ακέραια.
- **Save as Copy**: Η λειτουργία «Αποθήκευση ως αντίγραφο» του Joomla αντιγράφει αυτόματα και τα SmartCrop metadata στο νέο άρθρο.
- **Version History**: Το ενσωματωμένο σύστημα εκδόσεων του άρθρου (Content History) παρακολουθεί αυτόματα και το ιστορικό του framing.

---

## 6. Επίλυση της Effective Εικόνας του Άρθρου

Το SmartCrop εντοπίζει αυτόματα ποια είναι η effective εικόνα του άρθρου ακολουθώντας την εξής προτεραιότητα:
1. **Intro Image (`image_intro`)**: Αν έχει οριστεί εισαγωγική εικόνα στο άρθρο.
2. **Full Article Image (`image_fulltext`)**: Εφεδρική εικόνα αν δεν υπάρχει intro image.
3. **SmartVisuals**: Διακοσμείται προαιρετικά μέσω generic provider (βλ. επόμενη ενότητα).

---

## 7. Προαιρετική Συνεργασία με το Generic Contract `smartvisuals`

Αν στο σύστημα είναι εγκατεστημένα και ενεργά plugins της ομάδας `smartvisuals`:
- Το SmartCrop κάνει dispatch το generic event:
  ```php
  onSmartVisualsDecorateResources
  ```
- Με convention αναγνωριστικού πόρου:
  ```text
  article:123
  ```
- Το resource αποστέλλεται περιέχοντας ήδη την base/native εικόνα (αν υπάρχει). Ένας SmartVisuals provider μπορεί έτσι να προσφέρει fallback image αν το `resource['image']` είναι κενό.
- Το SmartCrop λειτουργεί **αυστηρά ως generic consumer**:
  - Δεν γνωρίζει ποιο plugin απάντησε.
  - Δεν γνωρίζει από ποιο custom field ή μηχανισμό προήλθε η εικόνα.
  - Δεν έχει κανένα hard dependency προς συγκεκριμένα sites ή extensions.
  - Τυχόν σφάλμα (`Throwable`) ενός provider απομονώνεται πλήρως και δεν εμποδίζει ποτέ τον editor.

---

## 8. Τι συμβαίνει όταν δεν βρίσκεται αυτόματα εικόνα

Αν ένα άρθρο δεν έχει ούτε `image_intro`, ούτε `image_fulltext`, και κανένας SmartVisuals provider δεν επέστρεψε εικόνα:
- Το UI του SmartCrop **δεν αποτυγχάνει ούτε καταρρέει**.
- Εμφανίζεται καθαρό μήνυμα κατάστασης:
  > *«Δεν εντοπίστηκε αυτόματα εικόνα άρθρου.»*
- Παρέχεται εμφανές κουμπί:
  > **«Επιλογή εικόνας»**

---

## 9. Manual Image Fallback (Χειροκίνητη Εφεδρική Εικόνα)

Όταν ο χρήστης επιλέγει χειροκίνητα μια εικόνα μέσω του SmartCrop:
- Η εικόνα χρησιμοποιείται **αποκλειστικά ως source για το framing**.
- **ΔΕΝ γράφεται** στο `image_intro`.
- **ΔΕΝ γράφεται** στο `image_fulltext`.
- **ΔΕΝ μεταβάλλει** κανένα άλλο πεδίο του άρθρου.
- Το αναγνωριστικό (`source`) αυτής της εικόνας αποθηκεύεται μέσα στα metadata του SmartCrop profile.
- Ένα template μπορεί αργότερα να επιλέξει ποια εικόνα θα προβάλει και να ελέγξει αν υπάρχει SmartCrop framing για τη συγκεκριμένη εικόνα.

---

## 10. Image Identity Normalization (Κανονικοποίηση Ταυτότητας Εικόνας)

Το crop συνδέεται πάντα με τη συγκεκριμένη εικόνα πάνω στην οποία δημιουργήθηκε.

Ο κεντρικός μηχανισμός `ImageNormalizer` διασφαλίζει ότι διαφορετικές αναπαραστάσεις της ίδιας εικόνας αναγνωρίζονται ως **ταυτόσημες**:
- Απλά paths: `images/sample.jpg`
- Leading slashes: `/images/sample.jpg`
- Backslashes: `images\sample.jpg`
- Joomla media fragments: `images/sample.jpg#joomlaImage://local-images/sample.jpg?width=1200&height=800`
- JSON objects/arrays από media fields: `{"imagefile":"images/sample.jpg"}`
- Same-site absolute URLs: `https://example.com/images/sample.jpg`
- URLs με υποφακέλους εγκατάστασης Joomla.
- URL-encoded διαδρομές: `images/my%20photo.jpg` $\leftrightarrow$ `images/my photo.jpg`.

### Αν η εικόνα του άρθρου αλλάξει:
- Το SmartCrop **δεν εφαρμόζει σιωπηρά το παλιό crop** στη νέα εικόνα.
- Εντοπίζει το mismatch μέσω του normalized `source`.
- Ειδοποιεί διακριτικά τον χρήστη ότι η εικόνα άλλαξε.
- Το νέο framing ξεκινά από λογική προεπιλογή πλήρους κάλυψης (centered cover).

---

## 11. Normalized Crop Schema

Οι συντεταγμένες δεν αποθηκεύονται σε απόλυτα pixels συγκεκριμένου viewport, αλλά ως **κανονικοποιημένες τιμές (normalized values) μεταξύ 0 και 1** σε σχέση με τις φυσικές διαστάσεις της αρχικής εικόνας:

- `x`: Οριζόντια έναρξη του crop window ($0.0 \le x \le 1.0$)
- `y`: Κατακόρυφη έναρξη του crop window ($0.0 \le y \le 1.0$)
- `width`: Πλάτος του crop window ($0.0 < width \le 1.0$, με $x + width \le 1.0$)
- `height`: Ύψος του crop window ($0.0 < height \le 1.0$, με $y + height \le 1.0$)
- `ratio`:
  - `width`: 4 (θετικός αριθμός)
  - `height`: 3 (θετικός αριθμός)
- `source`: Κανονικοποιημένο source identity string.
- `version`: `1` για δυνατότητα μελλοντικής εξέλιξης.
- `source_dimensions`: (προαιρετικά) φυσικές διαστάσεις εικόνας για σκοπούς debugging/validation.

---

## 12. Το Profile Model (`default`)

Στην έκδοση 0.1.0 υπάρχει ένα προφίλ:
```text
smartcrop
  └── profiles
        └── default
```
- Το aspect ratio ορίζεται στις ρυθμίσεις του plugin (Plugin Options):
  - **Default Ratio Width**: `4`
  - **Default Ratio Height**: `3`
  - **Προεπιλεγμένη αναλογία**: `4:3`
- Η δομή είναι profile-aware από την αρχή, επιτρέποντας μελλοντική επέκταση (π.χ. `banner`, `square`, `card`) χωρίς αλλαγή του βασικού schema.
- Αν αλλάξει η ρυθμισμένη αναλογία στις επιλογές του plugin και υπάρχει αποθηκευμένο crop με διαφορετική αναλογία, το σύστημα αποτρέπει την παραμόρφωση και ειδοποιεί για επαναφορά.

---

## 13. Public PHP API για Templates

Το template μπορεί να αποφασίσει αυτόνομα ποια εικόνα θα εμφανίσει και να ρωτήσει το SmartCrop:
*«Υπάρχει διαθέσιμο framing για αυτό το άρθρο, για ΑΥΤΗ την εικόνα και για το προφίλ default;»*

### Χρήση API:

```php
use SuperSoftJx\Plugin\Content\SmartCrop\Helper\SmartCropHelper;

// 1. Έλεγχος και ανάκτηση crop metadata
$crop = SmartCropHelper::getCrop($article, $imageUrl, 'default');

// Ή μέσω του global alias SmartCrop:
$crop = \SmartCrop::getCrop($article, $imageUrl);

if ($crop !== null) {
    // Υπάρχει έγκυρο crop για αυτή την εικόνα!
    $x      = $crop['crop']['x'];
    $y      = $crop['crop']['y'];
    $width  = $crop['crop']['width'];
    $height = $crop['crop']['height'];
}
```

### Έλεγχος Ύπαρξης Crop:

```php
if (\SmartCrop::hasCrop($article, $imageUrl)) {
    // ...
}
```

### Έτοιμοι Υπολογισμοί Παρουσίασης (Presentation Values):

```php
$presentation = \SmartCrop::getPresentation($article, $imageUrl);

if ($presentation !== null) {
    // Έτοιμα inline CSS styles:
    $containerStyle = $presentation['styles']['container'];
    $imageStyle     = $presentation['styles']['image'];

    // Ποσοστά και κλίμακες:
    $widthPct  = $presentation['values']['width_pct'];   // π.χ. 133.3333%
    $heightPct = $presentation['values']['height_pct'];  // π.χ. 177.7778%
    $leftPct   = $presentation['values']['left_pct'];    // π.χ. -16.6667%
    $topPct    = $presentation['values']['top_pct'];     // π.χ. -11.1111%
}
```

### Προαιρετικός Reusable HTML Renderer:

```php
// Παράγει αυτόματα το framed markup:
echo \SmartCrop::renderImage($article, $imageUrl, [
    'alt'             => $article->title,
    'class'           => 'my-article-img',
    'container_class' => 'my-custom-ratio-frame',
    'loading'         => 'lazy',
]);
```
*Σημείωση: Το template δεν υποχρεούται να χρησιμοποιήσει συγκεκριμένο HTML markup. Το API παρέχει πλήρη ελευθερία σχεδίασης.*

---

## 14. Παράδειγμα Responsive CSS Rendering

Το SmartCrop δεν απαιτεί JavaScript στο frontend. Η αναπαραγωγή του framing γίνεται 100% responsive μέσω καθαρού CSS.

### Τύποι Υπολογισμού CSS:
Για κανονικοποιημένο παράθυρο crop $(x, y, w, h)$:
$$\text{width} = \frac{1}{w} \times 100\%$$
$$\text{height} = \frac{1}{h} \times 100\%$$
$$\text{left} = -\frac{x}{w} \times 100\%$$
$$\text{top} = -\frac{y}{h} \times 100\%$$

### Template HTML & CSS Markup:

```html
<?php
$pres = \SmartCrop::getPresentation($item, $item->image);
if ($pres): ?>
    <div class="article-framing-box" style="<?= $pres['styles']['container']; ?>">
        <img src="<?= htmlspecialchars(\SuperSoftJx\Plugin\Content\SmartCrop\Service\ImageNormalizer::toUrl($item->image)); ?>"
             alt="<?= htmlspecialchars($item->title); ?>"
             style="<?= $pres['styles']['image']; ?>">
    </div>
<?php else: ?>
    <!-- Κανονική εμφάνιση όταν δεν υπάρχει crop -->
    <div class="article-standard-box">
        <img src="<?= htmlspecialchars($item->image); ?>" alt="<?= htmlspecialchars($item->title); ?>">
    </div>
<?php endif; ?>
```

---

## 15. Συμβατότητα Joomla 5.4.x & Joomla 6.x

- **Strict PSR-4 Namespaces**: `SuperSoftJx\Plugin\Content\SmartCrop`
- **Joomla Dependency Injection**: Καταχώριση υπηρεσίας μέσω `services/provider.php` (`ServiceProviderInterface`).
- **Joomla Web Asset Manager**: Καταχώριση assets μέσω `joomla.asset.json`. Τα scripts και styles του editor φορτώνονται **μόνο** στη φόρμα επεξεργασίας του άρθρου και ποτέ σε απλές frontend προβολές άρθρων.
- **Form Integration**: Ενσωμάτωση μέσω `onContentPrepareForm`, `onContentBeforeValidateData`, και `onContentBeforeSave`.
- **Χωρίς Joomla 4 B/C hacks**.
- **Πολυγλωσσικό**: Πλήρης υποστήριξη `en-GB` και `el-GR`.

---

## Εκτέλεση Test Suite & Build

### Τρέξιμο των Automated Tests:
```powershell
php tests/run_tests.php
```

### Δημιουργία Εγκαταστάσιμου ZIP:
```cmd
build.bat
```
Το αρχείο παράγεται στο: `build/output/plg_content_smartcrop-v1.0.0-beta2.zip`.

---

## 16. Ιστορικό Εκδόσεων (Changelog)

### v1.0.0-beta2 (2026-10-05)
- **Διόρθωση Αποθήκευσης & Ενημέρωσης URL (Web Component Synchronization)**:
  - Επίλυση του προβλήματος επαναφοράς του URL όπου το εγγενές web component `<joomla-field-media>` του Joomla κατά το `change` event εκτελούσε validation reset, διαγράφοντας τις παραμέτρους `?crop=...&ratio=...`.
  - Συγχρονισμός του `mediaWrapper.validatedUrl` και προστασία του `validateValue` ώστε το Joomla core να αποδέχεται και να διατηρεί άμεσα το enriched `#joomlaImage://` URI κατά την αποθήκευση του άρθρου.
  - Αποτροπή percent-encoding στις παραμέτρους query (`crop=x,y,w,h`) για καθαρή και αναγνώσιμη απεικόνιση στο πεδίο κειμένου.
- **Βελτιστοποίηση UI Πεδίου (Icon-Only Crop Button)**:
  - Μετατροπή του κουμπιού κάδρου σε συμπαγές icon-only κουμπί (`[ ✂️ ]`) μέσα στο `.input-group` ώστε να μην συμπιέζεται το διαθέσιμο πλάτος του textbox.
  - Προσθήκη δυναμικών accessibility attributes (`aria-label`) και επεξηγηματικών tooltips (`title`) ανάλογα με την κατάσταση (ανενεργό / ενεργό με πράσινη επισήμανση).
- **Πλήρης Υποστήριξη Συμβάντων Joomla 5/6 (`ContentPrepareEvent`)**:
  - Υποστήριξη τόσο του σύγχρονου `Joomla\CMS\Event\Content\ContentPrepareEvent` όσο και του legacy string context στο `onContentPrepare`.

### v1.0.0-beta1 (2026-10-05)
- **Universal Ενσωμάτωση στο UI (`.input-group`)**:
  - Το κουμπί `[ ✂️ Κάδρο ]` τοποθετείται απευθείας μέσα στο `.input-group` του πεδίου εικόνας, ακριβώς δίπλα στο textbox (`[ URL Textbox ] [ ✂️ Κάδρο ] [ Επιλογή ] [ ✕ ]`).
  - Δυναμική ένδειξη κατάστασης: όταν υπάρχει ενεργό κάδρο, το κουμπί εμφανίζεται πράσινο με ένδειξη `[ ✓ 4:3 ]`.
  - Εξάλειψη του ξεχωριστού διακεκομμένου πλαισίου κάτω από το πεδίο για απόλυτη ομοιομορφία με το native Joomla look and feel.
- **Εγγραφή και Ανάγνωση Κάδρου στο `#joomlaImage://` URL**:
  - Οι παράμετροι καδραρίσματος και ζουμ αποθηκεύονται απευθείας στο URI (`&crop=X,Y,W,H&ratio=4:3&zoom=Z`) ως φυσικό χαρακτηριστικό του αρχείου.
  - Πλήρης διαφάνεια προς το native Joomla: το `HTMLHelper::cleanImageURL()` αγνοεί τα extra query parameters και αποδίδει κανονικά το `src`.
- **Καθολική Υποστήριξη Custom Media Fields & Κατηγοριών**:
  - Αυτόματη ανίχνευση και λειτουργία σε **όλα** τα `<joomla-field-media>` στη σελίδα (Custom Fields τύπου `media`, εικόνες κατηγοριών, άρθρα κ.λπ.).
  - Δυνατότητα ορισμού κάδρου στο `placeholder-image` μιας κατηγορίας μία φορά, ώστε όλα τα άρθρα που κληρονομούν την εικόνα της κατηγορίας να εμφανίζουν αυτόματα το ίδιο κάδρο.
- **Καθαρή Αρχιτεκτονική Αποσύνδεσης (Decoupled Hooks & Public API)**:
  - Υλοποίηση του event `onContentPrepare` που εμπλουτίζει αυτόματα το αντικείμενο του άρθρου με έτοιμα presentation styles (`$item->smartcrop_intro_style`) για standard Joomla layouts.
  - Προσθήκη `SmartCropHelper::parseCropFromUri(string $uri)` και `SmartCropHelper::getCssStyle(mixed $imageOrArticle)` για 1-line κατανάλωση από custom layout engines και κάρτες (Zero CLS, zero coupling).

### v0.2.4 (2026-10-04)
- **Εξάλειψη SyntaxError `Unexpected token 'export'` στο JavaScript**:
  - Αφαίρεση του ασύμβατου ES module `export default` στο τέλος του `smartcrop-editor.js` και αντικατάσταση με ασφαλή περιβάλλουσα UMD/CJS διάγνωση. Το script πλέον γίνεται parse και εκτελείται άψογα ως classic deferred script σε οποιοδήποτε περιβάλλον χωρίς σφάλματα κονσόλας.
- **Απρόσκοπτη λειτουργία σε άρθρα χωρίς εικόνα (Empty State & Media Picker)**:
  - Όταν ένα άρθρο δεν διαθέτει αρχικά εικόνα, το modal ανοίγει κανονικά παρουσιάζοντας την κατάσταση Empty State.
  - Το κουμπί «Επιλογή εικόνας» (`data-smartcrop-select-media`) συνδέεται αυτόματα με το αντίστοιχο `<joomla-field-media>` του Joomla, ανοίγει το Media Manager dialog και, μόλις επιλεγεί η εικόνα, επαναφέρει αυτόματα το SmartCrop με ενεργά όλα τα εργαλεία Zoom/Pan.
- **Καθολικός Μηχανισμός Κλεισίματος Modal (Universal Close & Delegation)**:
  - Ενσωμάτωση της συνάρτησης `window.SmartCropCloseModal` και καθολικής ανάθεσης συμβάντων (click delegation) για όλα τα κουμπιά κλεισίματος και ακύρωσης (κουμπί Χ, κουμπί Ακύρωσης, κλικ έξω από το διάλογο, πλήκτρο Escape).

### v0.2.3 (2026-10-04)
- **Απόλυτη ανθεκτικότητα Modal σε Frontend, Gantry 5, UIkit και SmartBrowser**:
  - Αύξηση του `z-index` σε `2147483640` (μέγιστο ασφαλές 32-bit), υπερκαλύπτοντας ακόμα και το focused overlay του SmartBrowser (`2147483000`) που κάλυπτε το modal.
  - Ενσωμάτωση inline bootstrapper και καθολικής ανάθεσης συμβάντων (`document` click delegation) με `window.SmartCropOpenModal` και inline `onclick`, αποτρέποντας οποιαδήποτε αστοχία ανοίγματος ακόμα και αν το template (π.χ. Gantry 5) παρακάμπτει το WebAssetManager ή δεν έχει φορτωμένο το Bootstrap JS.
- **Απευθείας Database Fallback για την Εικόνα του Άρθρου**:
  - Όταν το Joomla FormModel δεν έχει κάνει bind τα δεδομένα εικόνων κατά την κλήση του πεδίου, το SmartCrop ανακτά αυτόματα τις τιμές των εικόνων και τα smartcrop προφίλ απευθείας από τη βάση δεδομένων (`#__content`), διασφαλίζοντας ότι η εικόνα εμφανίζεται πάντα στο modal χωρίς κενή κατάσταση.
- **Ακλόνητη λειτουργία Zoom Controls & Απομόνωση από CSS προτύπου**:
  - Εφαρμογή `.style.setProperty(..., 'important')` στις διαστάσεις και στον μετασχηματισμό της εικόνας, ώστε κανένα κανόνας του template (όπως `img { max-width: 100% !important; }` σε UIkit/Gantry) να μην παρεμποδίζει το Zoom Slider, τα κουμπιά `+` / `-` και τα Quick Presets.
- **Αλάνθαστος Εντοπισμός Media Field & Κουμπιού Επιλογής Εικόνας**:
  - Στοχευμένη αναζήτηση εισόδου (`input[name="jform[images][image_intro]"]`), σύνδεση με το `.button-select` του `<joomla-field-media>` και αυτόματη επαναφορά του κάδρου με την επιλεγμένη εικόνα.

### v0.2.2 (2026-10-04)
- **Ανεξάρτητη υποστήριξη Modal (χωρίς εξάρτηση από Bootstrap JS)**:
  - Το άνοιγμα και το κλείσιμο του modal λειτουργεί πλέον αυτόνομα και εγγενώς με vanilla JavaScript, εξασφαλίζοντας 100% αξιόπιστη λειτουργία στο frontend και σε custom templates όπου το Bootstrap Modal JS δεν είναι φορτωμένο.
  - Αυτόματη μετακίνηση του modal στο `document.body` ώστε να μην εγκλωβίζεται ποτέ μέσα σε scrollable fieldsets, popups ή dashboards (π.χ. SmartBrowser).
- **Υποστήριξη δυναμικών/AJAX φορμών**:
  - Προσθήκη `MutationObserver` στο `document.body` για άμεση ενεργοποίηση του SmartCrop σε φόρμες που φορτώνονται δυναμικά μέσω AJAX (όπως στα dashboards και modals του SmartBrowser).
- **Πολυεπίπεδη αναγνώριση πεδίων εικόνας (4-tier detection)**:
  - Αλάνθαστος εντοπισμός του συνδεδεμένου πεδίου πολυμέσων (`<joomla-field-media>`), του input και του κουμπιού επιλογής είτε βάσει γονικού fieldset, είτε βάσει ονόματος/ID, είτε βάσει θέσης στη φόρμα.
- **Αμφίδρομη γέφυρα με τον Media Manager**:
  - Το κουμπί «Επιλογή εικόνας» ανοίγει άμεσα τον εγγενή Media Manager του Joomla και επαναφέρει αυτόματα το modal με τη νέα εικόνα φορτωμένη.

### v0.2.1 (2026-10-04)
- Διόρθωση εντοπισμού εικόνας άρθρου και υποστήριξη subfolder base URLs.
- Υποστήριξη σχημάτων `#joomlaImage://local-images/...` και `local-images:/...`.
- Real-time listeners στα πεδία `image_intro` και `image_fulltext`.

