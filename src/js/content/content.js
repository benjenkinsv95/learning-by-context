import '../../css/content.css'

const $ = require('jquery')
const { knuthShuffle } = require('knuth-shuffle')
const {
  sortBySourceLanguage, addInsensitiveContainsToJQuery, chooseRandomElementFrom,
  capitalizeFirstLetter, getMatchesAsArray, isCapitalized, getSimplifiedHtmlForMatching/*, getParentDOMNodes */
} = require('./utils')
// load the store object where I will add different pieces of data
const store = require('./store')

store.styles = require('./styles')

addInsensitiveContainsToJQuery($)

const buildKnownSourceLanguageWordsSelector = () => {
  const sourceLanguageCssQueries = store.sourceLanguageToTargetLanguageEntries.map(
    ([sourceLanguage]) => {
      return `*:icontains("${sourceLanguage}")`
    }
  )

  // combine the individiual queries into one massive query with a comma
  return sourceLanguageCssQueries.join(',')
}

store.twitterElements = '.DraftEditor-root,.public-DraftStyleDefault-block,.public-DraftStyleDefault-block > span > span'
// Elements to avoid selecting
store.elementsNotToContain = 'style,meta,script,noscript,base,title,link,embed'
store.elementsNotToSelect = store.elementsNotToContain + `img,area,audio,map,track,video,iframe,object,param,picture,source,svg,math,canvas,datalist,fieldset,input,optgroup,option,select,textarea,slot,template,applet,basefont,bgsound,frame,frameset,image,isindex,keygen,menuitem,multicol,nextid,noembed,noframes,plaintext,shadow,spacer,xmp,code,code *,${store.twitterElements}`

// Classes of elements that will be injected into the page. We will ignore searching inside of them for matches
// since they have already matched and been replaced.
store.injectedCssClasses = '.target-to-source-language-wrapper,.target-to-source-language-tooltip-text,.target-to-source-language-replacement'

// Find the inner most elements that match the source language
const getInnerMostSourceLanguageElements = (containerSelector) => {
  // If the container is an element we created or is an element we don't want to select
  if ($(containerSelector).is(store.injectedCssClasses) || $(containerSelector).is(store.elementsNotToSelect)) {
    // return nothing
    return $(null)
  }

  // Find every element inside the container that matches a word we know about from the source language
  // and include the container itself
  const allSourceLanguageMatchedElements = $(containerSelector)
    .add($(containerSelector).find(store.knownSourceLanguageWordsSelector))

  // use regex to verify these matches are what we expect (this makes sure we don't match words inside of another word)
  // ex. god shouldnt match inside zygodactyl (Hello future reader, yes this is a very specific and annoying bug on the parrot wiki page)
  const allVerifiedSourceLanguageMatchedElements = allSourceLanguageMatchedElements.filter(function () {
    const html = $(this).html() ? $(this).html() : ''
    return store.allSourceLanguagePhrasesRegex.test(html.toLowerCase())
  })

  // Find elements with matches that don't contain other elements that match
  // So we find the most specific match.
  const innermostSourceLanguageElements = allVerifiedSourceLanguageMatchedElements.not(
    allVerifiedSourceLanguageMatchedElements.has(allVerifiedSourceLanguageMatchedElements)
  )

  // filter out any sourceLanguage words that have already been switched
  // useful to avoid processing the same word twice and if the sourceLanguage and targetLanguage are the same
  const innermostWithoutMarked = innermostSourceLanguageElements
    .not(store.injectedCssClasses)
    .not(innermostSourceLanguageElements.has(store.injectedCssClasses))

  // Filter out any elements from the list of elements not to select (so we dont return script tags or style tags)
  const innermostWithoutElementsNotToSelect = innermostWithoutMarked
    .not(store.elementsNotToSelect)
    .not(innermostWithoutMarked.has(store.elementsNotToContain))

  return innermostWithoutElementsNotToSelect
}

// match a single sourceLanguage phrase
// select sourceLanguage phrases, match at word breaks (\b)
const createIndividuaSourceLanguageRegexString = (sourceLanguagePhrase) => {
  // Don't match the inside of inner tags only match the content itself
  // Following this approach: https://stackoverflow.com/a/31389823/3500171
  const betweenEachNonSpace = '(?:<[^>]+>)*'
  const replacementRegexToMatchSpaces = '(?:\\s*<[^>]+>\\s*)*\\s+(?:\\s*<[^>]+>\\s*)*'

  // split into source language words
  let sourceLanguageWords = sourceLanguagePhrase.split(/ /)

  // dont match angle brackets between non space characters
  sourceLanguageWords = sourceLanguageWords.map(word => word.split(/(?!$)/u).join(betweenEachNonSpace))

  // rejoin and dont match sapces in angle brackets
  const sourceLanguageRegex = sourceLanguageWords.join(replacementRegexToMatchSpaces)

  // Make sure there is either a word boundary or a double quote for an html string in front of it
  return `(\\b${sourceLanguageRegex}\\b)`
}

// match a single sourceLanguage phrase with regex
const createIndividualSourceLanguageRegex = (sourceLanguage, flags = 'gi') => {
  const individualRegex = createIndividuaSourceLanguageRegexString(sourceLanguage)
  // wrap in parenthesis, so we can match a single sourceLanguage phrase later and replace their name
  return new RegExp(`(${individualRegex})`, flags)
}

// Build a regex that matches any source language phrase
const buildAllSourceLanguagePhrasesRegex = () => {
  // Build regex to search for any of the sourceLanguage phrases names https://stackoverflow.com/a/185529/3500171

  const sourceLanguagePhraseRegexStr = store.sourceLanguageToTargetLanguageEntries
    .map(([sourceLanguage]) =>
      createIndividuaSourceLanguageRegexString(
        sourceLanguage
      )
    ) // (surely is not)
    .join('|') // (surely is not)|(Actor)

  // wrap in parenthesis, so we can match a single sourceLanguage phrases later and replace their name
  // NOTE: Must include 'g' if we want to only match the full pattern
  // include i so it is case insesitive
  return new RegExp(`(${sourceLanguagePhraseRegexStr})`, 'gi')
}

// Return the specific source language to target language we are looking for
const findSpecificSourceLanguagePhrase = (text) => {
  let individualSourceLanguagePhraseRegexAll

  // search for the specific possible sourceLanguage phrase we matched, so we can verify they are an sourceLanguage phrase
  const specificSourceLanguageToTargetLanguage = store.sourceLanguageToTargetLanguageEntries
    .find(([sourceLanguagePhrase]) => {
      individualSourceLanguagePhraseRegexAll = createIndividualSourceLanguageRegex(sourceLanguagePhrase)

      // if the current sourceLanguage phrase matches contains the phrase we matched, then we found the object we are looking for
      const currentSourceLanguagePhraseMatches = text.match(individualSourceLanguagePhraseRegexAll)

      // If we have matches, then this is the specific source language phrase we were looking for
      return currentSourceLanguagePhraseMatches && currentSourceLanguagePhraseMatches.length > 0
    })

  return specificSourceLanguageToTargetLanguage
}

const replaceWords = (innerMostNode) => {
  let html = innerMostNode.html()

  // Simplify tags to make matching easier to perform with a regex
  const simplifiedHtmlForMatching = getSimplifiedHtmlForMatching(html)
  // Reverse matches so we can loop through it backwards, this way when we replace text we don't affect indexes for future elements
  const sourceLanguagePhraseMatches = getMatchesAsArray(
    store.allSourceLanguagePhrasesRegex,
    simplifiedHtmlForMatching
  ).reverse()
  // console.log(html, '\n')
  // console.log(simplifiedHtmlForMatching, '\n')
  // console.log(sourceLanguagePhraseMatches, '\n')

  // if we found source language phrases
  if (sourceLanguagePhraseMatches && sourceLanguagePhraseMatches.length > 0) {
    // find the parent dom nodes, so we can ensure they have the same textContent afterwards
    // TODO: Get working or replace logic
    // const innerMostNodeDOM = innerMostNode[0]
    // const parents = getParentDOMNodes(innerMostNodeDOM)
    // const parentsWithTextContent = parents.map(parent => ({ parent, textContent: parent.textContent }))

    // loop through each source language phrase we matched
    for (const sourceLanguagePhraseMatch of sourceLanguagePhraseMatches) {
      const { matchText, startIndex, endIndex } = sourceLanguagePhraseMatch

      const specificSourceLanguageToTargetLanguage = findSpecificSourceLanguagePhrase(matchText)

      if (specificSourceLanguageToTargetLanguage) {
        // select a random target language to use as a replacement
        const targetLanguageWords = specificSourceLanguageToTargetLanguage[1]
        const randomTargetLanguageWord = chooseRandomElementFrom(targetLanguageWords)

        // If less than replacementPercentage, replace with targetLanguage word
        const shouldReplace = Math.random() <= (store.replacementPercentage / 100.0)
        let replacement = shouldReplace ? randomTargetLanguageWord : matchText

        if (isCapitalized(matchText)) {
          replacement = capitalizeFirstLetter(replacement)
          // console.log(`Replacing ${matchText} with ${replacement}`)
        }

        // Get a display of all possible target phrases
        const targetLanguagesAllDisplay = targetLanguageWords.join(' | ')

        // Get the text for the title text
        const titleText = shouldReplace
          ? matchText + ` (${targetLanguagesAllDisplay})`
          : targetLanguagesAllDisplay

        // extract styles
        const { duoReplacedStyles, duoSkippedStyles, unsetEverythingStyles, wrapperStyles, tooltipStyles } = store.styles
        const innerStyles = shouldReplace ? duoReplacedStyles : duoSkippedStyles

        // build replacement html
        const newMatchHtml =
          `<span class="target-to-source-language-wrapper" style="${unsetEverythingStyles + wrapperStyles}">` +
          `<abbr class="target-to-source-language-tooltip-text"  style="${tooltipStyles}" title="${titleText}">` +
          `<span style="${innerStyles}" tabindex="-1" class="target-to-source-language-replacement">` +
          `${replacement}` +
          '</span>' +
          '</abbr>' +
          '</span>'

        // replace the text with the wrapped html
        // TODO: Likely want to replace html instead of text
        html = html.slice(0, startIndex) + newMatchHtml + html.slice(endIndex)
      }
    }

    // replace the source language phrases with the target phrases html
    // console.log('\nold html', $(innerMostNode).html(), '\n\nnew html', html)
    $(innerMostNode).html(html)

    // TODO: Get working or replace logic
    // setInterval(() => {
    //   // After replacing the text, update the textContent for this element and its parent back to the original text
    // // this is important for content that is initially shown but can later be edited.
    //   parentsWithTextContent.forEach(({ parent, textContent }) => {
    //     try {
    //       console.log('setting textContent of ', parent, ' to ', textContent)
    //       Object.defineProperty(parent, 'textContent', { value: textContent, writable: false })
    //     } catch (err) {
    //       console.error(err)
    //     }
    //   })
    // }, 5000)
  }
}

// Callback function to execute when mutations are observed
const markNewContent = function (mutationsList, observer) {
  // console.log('Marking new content')
  for (const mutation of mutationsList) {
    for (const node of mutation.addedNodes) {
      // if the node isnt a node we already inserted and it isnt a node we dont want to select
      if (!$(node).is(store.injectedCssClasses) && !$(node).is(store.elementsNotToSelect)) {
        // find the sourceLanguage phrases
        getInnerMostSourceLanguageElements(node).each(function () {
          // for each node we found with a match, replace words in it
          replaceWords($(this))
        })
      }
    }
  }
}

function restoreOptions () {
  // Use default value color = 'red' and likesColor = true.
  // eslint-disable-next-line no-undef
  chrome.storage.sync.get(
    {
      username: '',
      replacementPercentage: 100
    },
    function ({ username, replacementPercentage }) {
      // we use local storage for sourceLanguageToTargetLanguageEntries since it can be very large
      // eslint-disable-next-line no-undef
      chrome.storage.local.get(
        {
          sourceLanguageToTargetLanguageEntries: [] // default to an empty array until we can fetch some
        },
        function ({ sourceLanguageToTargetLanguageEntries }) {
          store.replacementPercentage = replacementPercentage

          console.log('sourceLanguageToTargetLanguageEntries', sourceLanguageToTargetLanguageEntries)
          // randomize all entries
          knuthShuffle(sourceLanguageToTargetLanguageEntries)
          // pick off the first 100,
          const randomEntries = sourceLanguageToTargetLanguageEntries.slice(0, 500)
          // then sort them so the most specific options are picked first
          sortBySourceLanguage(randomEntries)

          store.sourceLanguageToTargetLanguageEntries = randomEntries

          // build after loading source phrases to target phrases
          store.knownSourceLanguageWordsSelector = buildKnownSourceLanguageWordsSelector()
          store.allSourceLanguagePhrasesRegex = buildAllSourceLanguagePhrasesRegex()
          console.log({ username })

          // Make an ajax request to fetch the source to target phrases
          $.ajax({
            url:
          'https://duolingo-django-api.herokuapp.com/source_to_target_phrases/',
            method: 'POST',
            data: {
              username
            }
          })
            .then((responseDataStr) => {
              const responseData = JSON.parse(responseDataStr)
              console.log('source to target phrases from api', responseData.source_to_target_translations)

              const newSourceLanguageToTargetLanguageEntries = Object.entries(
                responseData.source_to_target_translations
              )
              // Sort entries so longer entries come up first. So we match the longest text if it includes multiple words
              sortBySourceLanguage(newSourceLanguageToTargetLanguageEntries)

              // eslint-disable-next-line no-undef
              chrome.storage.local.set({ sourceLanguageToTargetLanguageEntries: newSourceLanguageToTargetLanguageEntries }, function () {
                console.log('New source to target phrases loaded')
              })
            }
            )
            .catch((error) =>
              console.error('failed to fetch source to target phrases', error)
            )

          // get the innermost elements that contain a source language phrase
          getInnerMostSourceLanguageElements('body').each(function () {
            // replace the source language phrase within each element
            replaceWords($(this))
          })

          // Options for the observer (which mutations to observe)
          const config = { childList: true, subtree: true }
          // Create an observer instance linked to the callback function
          // eslint-disable-next-line no-undef
          const observer = new MutationObserver(markNewContent)

          // Start observing the target node for configured mutations
          observer.observe(document, config)
        }
      )
    })
}

// eslint-disable-next-line no-undef
chrome.extension.sendMessage({}, function (response) {
  const readyStateCheckInterval = setInterval(function () {
    if (document.readyState === 'complete') {
      clearInterval(readyStateCheckInterval)

      // This part of the script triggers when page is done loading
      console.log('Language Through Context Loaded')
      $(() => {
        // Look for all of our sourceLanguage phrases and replace some of them
        restoreOptions()
        // document.addEventListener('DOMContentLoaded', restore_options)
      })
    }
  }, 10)
})
