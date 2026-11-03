# Home page slideshow

Every picture in this folder is a slide on the home page's front door
(`HomeHero`), after NetLet's street (`../auth/welcome.webp`), in file-name
order — `02-on-the-road`, `03-one-cart`, `04-unboxing`, `05-delivery` now. To
reorder them, rename them; to add one, give it the next number.

- **Shape:** wide, 16:9, at least 1600 × 900. The band crops each picture to
  fill it — about 16:9 on a phone, 3:1 in a rounded frame on a wide screen —
  so keep what matters in the middle, a little below centre.
- **A large copy, for a sharp wide screen:** the same picture 3200 × 1800,
  saved under the same name in `large/` (`large/02-on-the-road.webp`). A wide
  screen draws the band up to 1616px across, twice that on a Retina screen, so
  a 1600px picture is soft there; with a large copy it is not. The street has
  one in `../auth/large/welcome.webp`. Without one the picture itself is used.
- **Edges:** on a phone the foot fades into the page, so the bottom should be
  calm. On a wide screen nothing is drawn over the picture.
- **File:** WebP at quality 80, under 150 KB. A slide is fetched just before
  it is shown, but each one is still a download on a phone.
- **A phone copy, if you can:** the same picture 960 px wide, WebP at quality
  about 78, saved under the same name in `phone/` (`phone/02-on-the-road.webp`).
  A phone downloads that instead — about half the bytes — and a picture with no
  phone copy is sent whole, so leaving it out only costs a phone the download.
  The street has one too, in `../auth/phone/welcome.webp`.
- **No words** in a picture: the band's own line is the words, and a picture's
  words could not change with the page's language.

A picture that is removed simply stops being a slide; one picture alone is a
still with no controls.
