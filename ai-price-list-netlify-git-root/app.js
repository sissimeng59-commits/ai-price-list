(function () {
  var STORAGE_KEY = "ai-price-list-tasks-v05";
  var homeView = document.getElementById("homeView");
  var chatView = document.getElementById("chatView");
  var homeForm = document.getElementById("homeForm");
  var chatForm = document.getElementById("chatForm");
  var homeInput = document.getElementById("homeInput");
  var chatInput = document.getElementById("chatInput");
  var homeSendBtn = document.getElementById("homeSendBtn");
  var chatSendBtn = document.getElementById("chatSendBtn");
  var chatStream = document.getElementById("chatStream");
  var chatScroll = document.getElementById("chatScroll");
  var backHomeBtn = document.getElementById("backHomeBtn");
  var openMenuBtn = document.getElementById("openMenuBtn");
  var closeMenuBtn = document.getElementById("closeMenuBtn");
  var menuOverlay = document.getElementById("menuOverlay");
  var openLibraryBtn = document.getElementById("openLibraryBtn");
  var openLibraryFromChatBtn = document.getElementById("openLibraryFromChatBtn");
  var historyOverlay = document.getElementById("historyOverlay");
  var checklistOverlay = document.getElementById("checklistOverlay");
  var historyList = document.getElementById("historyList");
  var checklistList = document.getElementById("checklistList");
  var closeHistoryBtn = document.getElementById("closeHistoryBtn");
  var closeChecklistBtn = document.getElementById("closeChecklistBtn");
  var menuHistoryBtn = document.getElementById("menuHistoryBtn");
  var menuChecklistBtn = document.getElementById("menuChecklistBtn");
  var menuExportBtn = document.getElementById("menuExportBtn");
  var historyExportBtn = document.getElementById("historyExportBtn");
  var questionSheet = document.getElementById("questionSheet");
  var questionForm = document.getElementById("questionForm");
  var closeQuestionBtn = document.getElementById("closeQuestionBtn");
  var closeQuestionBackdrop = document.getElementById("closeQuestionBackdrop");
  var generateQuestionBtn = document.getElementById("generateQuestionBtn");
  var priceTableTemplate = document.getElementById("priceTableTemplate");

  var tasks = loadTasks();
  var currentTaskId = null;
  var activeOverlay = null;
  var activeQuestionTaskId = null;
  var loadingPriceTaskId = null;

  homeForm.addEventListener("submit", function (event) {
    event.preventDefault();
    submitNeed(homeInput);
  });

  chatForm.addEventListener("submit", function (event) {
    event.preventDefault();
    submitNeed(chatInput);
  });

  [homeInput, chatInput].forEach(function (input) {
    input.addEventListener("input", function () {
      autoResize(input);
      updateSendState();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        input.form.requestSubmit();
      }
    });
  });

  backHomeBtn.addEventListener("click", showHome);
  openMenuBtn.addEventListener("click", function () {
    openOverlay("menu");
  });
  closeMenuBtn.addEventListener("click", closeOverlay);
  openLibraryBtn.addEventListener("click", function () {
    openOverlay("history");
  });
  openLibraryFromChatBtn.addEventListener("click", function () {
    openOverlay("history");
  });
  menuHistoryBtn.addEventListener("click", function () {
    openOverlay("history");
  });
  menuChecklistBtn.addEventListener("click", function () {
    openOverlay("checklist");
  });
  menuExportBtn.addEventListener("click", exportJson);
  historyExportBtn.addEventListener("click", exportJson);
  closeHistoryBtn.addEventListener("click", closeOverlay);
  closeChecklistBtn.addEventListener("click", closeOverlay);
  closeQuestionBtn.addEventListener("click", closeQuestionSheet);
  closeQuestionBackdrop.addEventListener("click", closeQuestionSheet);
  generateQuestionBtn.addEventListener("click", generateQuestionRecommendations);

  document.querySelectorAll("[data-close-overlay]").forEach(function (element) {
    element.addEventListener("click", closeOverlay);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeQuestionSheet();
      closeOverlay();
    }
  });

  updateSendState();
  showHome();

  async function submitNeed(input) {
    var value = input.value.trim();
    if (!value) {
      showToast("先输入想买什么");
      input.focus();
      return;
    }

    setSubmitting(true);
    try {
      var analysisResponse = await postJson("/.netlify/functions/analyze-shopping", {
        text: value,
        input: value
      }, function () {
        return localAnalyze(value);
      });
      logResponseSource("analyze-shopping", analysisResponse);
      var analysis = normalizeAnalysisResponse(analysisResponse, value);

      var task = {
        id: makeId(),
        createdAt: new Date().toISOString(),
        originalInput: value,
        status: analysis.status,
        analysisResult: analysis,
        selectedOption: null,
        priceResults: null,
        checklistStatus: "pending",
        notes: ""
      };

      tasks.unshift(task);
      currentTaskId = task.id;
      saveTasks();
      input.value = "";
      autoResize(input);
      showChat();
      renderChat();
    } catch (error) {
      showToast(error.message || "分析失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  async function searchPrice(taskId, option) {
    var task = findTask(taskId);
    if (!task) return;

    setSelectedOptionForPrice(task, option || getDefaultOption(task));
    loadingPriceTaskId = task.id;
    saveTasks();
    renderAll();
    scrollChatToBottom();

    try {
      var keyword = getTaskKeyword(task);
      var priceResponse = await postJson("/.netlify/functions/search-price", {
        query: keyword,
        keyword: keyword,
        originalInput: task.originalInput,
        selectedOption: task.selectedOption
      }, function () {
        return localSearchPrice(keyword, task.originalInput, task.selectedOption);
      });
      logResponseSource("search-price", priceResponse);
      var result = normalizePriceResponse(priceResponse, keyword);

      task.priceResults = Object.assign({}, result, {
        searchedAt: new Date().toISOString()
      });
      saveTasks();
      showToast("查价结果已更新");
    } catch (error) {
      showToast(error.message || "查价失败，请稍后再试");
    } finally {
      loadingPriceTaskId = null;
      renderAll();
      if (task.priceResults && task.priceResults.items && task.priceResults.items.length) {
        scrollToResultStart(task.id, "price");
      } else {
        scrollChatToBottom();
      }
    }
  }

  function showHome() {
    homeView.classList.remove("hidden");
    chatView.classList.add("hidden");
    closeOverlay();
    closeQuestionSheet();
  }

  function showChat() {
    homeView.classList.add("hidden");
    chatView.classList.remove("hidden");
    window.setTimeout(scrollChatToBottom, 0);
  }

  function renderAll() {
    renderChat();
    if (activeOverlay === "history") renderHistory();
    if (activeOverlay === "checklist") renderChecklist();
    if (activeQuestionTaskId) renderQuestionSheet();
  }

  function renderChat() {
    chatStream.innerHTML = "";
    var task = getCurrentTask();
    if (!task) {
      appendAiBubble("输入一个购物需求，我会帮你一步步推进到可以查价。");
      return;
    }

    appendUserBubble(task.originalInput);

    if (task.status === "direct_price_search") {
      appendAiBubble("这个已经比较明确，可以直接帮你查各平台补贴价。");
      appendDirectCard(task);
      appendPriceStep(task);
      return;
    }

    if (task.status === "need_recommendation") {
      appendAiBubble("我先帮你缩小范围，选一个更接近你需求的方向。");
      if (!task.selectedOption && !task.priceResults) {
        appendRecommendationCards(task);
      } else {
        appendUserBubble("我选：" + getSelectedName(task));
        appendPriceStep(task);
      }
      return;
    }

    appendAiBubble("这个要先确认几个条件，我再推荐更合适的型号。");
    if (!hasGeneratedQuestions(task)) {
      appendQuestionStartCard(task);
    } else {
      appendUserBubble("我选择的条件：" + getAnswerSummary(task));
      if (!task.selectedOption.chosenRecommendation && !task.priceResults) {
        appendQuestionRecommendationCards(task);
      } else {
        appendUserBubble("查这个：" + getSelectedName(task));
        appendPriceStep(task);
      }
    }
  }

  function appendPriceStep(task) {
    if (loadingPriceTaskId === task.id) {
      appendAiBubble("正在整理各平台优惠价……", "loading-text");
      return;
    }

    if (task.priceResults && task.priceResults.items && task.priceResults.items.length) {
      appendPricePlanCard(task);
    }
  }

  function appendUserBubble(text) {
    var message = document.createElement("div");
    message.className = "message user";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    message.appendChild(bubble);
    chatStream.appendChild(message);
  }

  function appendAiBubble(text, extraClass) {
    var message = document.createElement("div");
    message.className = "message ai";
    var bubble = document.createElement("div");
    bubble.className = "bubble" + (extraClass ? " " + extraClass : "");
    bubble.textContent = text;
    message.appendChild(bubble);
    chatStream.appendChild(message);
  }

  function appendCard(card) {
    var message = document.createElement("div");
    message.className = "message ai";
    message.appendChild(card);
    chatStream.appendChild(message);
  }

  function appendDirectCard(task) {
    if (task.priceResults) return;
    var card = makeAiCard("查价关键词");
    appendKeywordRow(card, task.analysisResult.priceKeyword);
    var row = actionRow();
    row.appendChild(makeButton("查各平台价格", "primary-button", function () {
      searchPrice(task.id, {
        name: "直接查价",
        keyword: task.analysisResult.priceKeyword
      });
    }));
    card.appendChild(row);
    appendCard(card);
  }

  function appendRecommendationCards(task) {
    var card = makeAiCard("推荐方向");
    var grid = document.createElement("div");
    grid.className = "option-grid";
    (task.analysisResult.recommendations || []).forEach(function (item) {
      grid.appendChild(renderOptionCard(item, function () {
        searchPrice(task.id, item);
      }));
    });
    card.appendChild(grid);
    appendCard(card);
  }

  function appendQuestionStartCard(task) {
    var card = makeAiCard("先选条件");
    appendParagraph(card, "我会问 2-3 个关键问题，选完再给你推荐方向。");
    var row = actionRow();
    row.appendChild(makeButton("开始选择条件", "primary-button", function () {
      openQuestionSheet(task.id);
    }));
    card.appendChild(row);
    appendCard(card);
  }

  function appendQuestionRecommendationCards(task) {
    var card = makeAiCard("推荐型号/方向");
    markResultPanel(card, task.id, "recommendation");
    var grid = document.createElement("div");
    grid.className = "option-grid";
    getQuestionRecommendations(task).forEach(function (item) {
      var option = document.createElement("div");
      option.className = "option-card";
      option.innerHTML = [
        "<h3></h3>",
        "<p class=\"reason\"></p>",
        "<p><strong>查价关键词：</strong><span class=\"keyword-text\"></span></p>"
      ].join("");
      option.querySelector("h3").textContent = item.name;
      option.querySelector(".reason").textContent = item.reason;
      option.querySelector(".keyword-text").textContent = item.keyword;
      var row = actionRow();
      row.appendChild(makeButton("查这个价格", "primary-button", function () {
        searchPrice(task.id, item);
      }));
      option.appendChild(row);
      grid.appendChild(option);
    });
    card.appendChild(grid);
    appendCard(card);
  }

  function appendPricePlanCard(task) {
    var items = task.priceResults.items || [];
    if (!items.length) return;

    var card = makeAiCard("价格对比结果");
    markResultPanel(card, task.id, "price");
    var summary = document.createElement("p");
    summary.className = "price-summary";
    summary.textContent = getPriceConclusion(task);
    card.appendChild(summary);
    card.appendChild(renderPriceMobileList(task));
    card.appendChild(renderPriceTable(task));

    var row = actionRow();
    row.appendChild(makeButton(task.checklistStatus === "checked" || task.checklistStatus === "purchased" ? "已加入清单" : "加入清单", "secondary-button", function () {
      task.checklistStatus = task.checklistStatus === "checked" ? "pending" : "checked";
      saveTasks();
      renderAll();
    }));
    row.appendChild(makeButton(task.checklistStatus === "purchased" ? "已购买" : "标记已购买", "secondary-button", function () {
      task.checklistStatus = task.checklistStatus === "purchased" ? "checked" : "purchased";
      saveTasks();
      renderAll();
    }));
    row.appendChild(makeButton("重新查价", "secondary-button", function () {
      searchPrice(task.id, task.selectedOption || getDefaultOption(task));
    }));
    row.appendChild(makeButton("复制查价关键词", "secondary-button", function () {
      copyText(task.priceResults.keyword || getTaskKeyword(task));
    }));
    card.appendChild(row);

    var notice = document.createElement("p");
    notice.className = "muted";
    notice.textContent = task.priceResults.notice || "AI 查询价仅供参考，最终以打开页面为准。";
    card.appendChild(notice);

    var debug = document.createElement("p");
    debug.className = "muted debug-source";
    debug.textContent = getDebugSourceText(task.priceResults);
    card.appendChild(debug);

    appendCard(card);
  }

  function getPriceConclusion(task) {
    var items = task.priceResults.items || [];
    var top = items[0];
    var pdd = items.find(function (item) {
      return item.platform.indexOf("拼多多") !== -1;
    });

    if (top && top.platform.indexOf("京东") !== -1 && pdd) {
      return "首选京东，物流快，售后稳；追求低价可看拼多多。";
    }
    if (top && pdd && top.platform !== pdd.platform) {
      return "首选" + top.platform + "，综合体验更稳；追求低价可看" + pdd.platform + "。";
    }
    if (top) {
      return "首选" + top.platform + "，建议先看规格、券后价和店铺资质。";
    }
    return "先看综合体验，再对比低价平台。";
  }

  function renderPriceMobileList(task) {
    var list = document.createElement("div");
    list.className = "price-mobile-list";
    (task.priceResults.items || []).slice(0, 4).forEach(function (item, index) {
      var card = document.createElement("article");
      card.className = "price-rank-card" + (index === 0 ? " is-featured" : "");
      card.innerHTML = [
        "<div class=\"price-card-top\">",
        "  <div class=\"platform-lockup\">",
        "    <span class=\"platform-mark\"></span>",
        "    <strong class=\"platform-title\"></strong>",
        "  </div>",
        "  <span class=\"mobile-rank-label\"></span>",
        "</div>",
        "<div class=\"price-card-main\">",
        "  <div>",
        "    <div class=\"mobile-price-value\"></div>",
        "    <p class=\"price-spec\"></p>",
        "    <p class=\"price-suggestion\"></p>",
        "  </div>",
        "  <a class=\"table-link price-card-link\" target=\"_blank\" rel=\"noopener\">打开看看</a>",
        "</div>",
        "<p class=\"price-discount\"></p>"
      ].join("");

      card.querySelector(".platform-mark").textContent = getPlatformMark(item.platform);
      card.querySelector(".platform-title").textContent = item.platform;
      card.querySelector(".mobile-rank-label").textContent = getMobileRankLabel(item, index);
      card.querySelector(".mobile-price-value").textContent = item.estimatedPrice;
      card.querySelector(".price-spec").textContent = item.spec + " · " + item.unitPrice;
      card.querySelector(".price-suggestion").textContent = item.suggestion;
      card.querySelector(".price-discount").textContent = item.discount;
      card.querySelector(".price-card-link").href = item.url;
      list.appendChild(card);
    });
    return list;
  }

  function getMobileRankLabel(item, index) {
    if (index === 0) return "推荐";
    if (item.platform.indexOf("拼多多") !== -1) return "低价";
    return "";
  }

  function getPlatformMark(platform) {
    if (platform.indexOf("京东") !== -1) return "京";
    if (platform.indexOf("天猫") !== -1 || platform.indexOf("淘宝") !== -1) return "猫";
    if (platform.indexOf("拼多多") !== -1) return "多";
    if (platform.indexOf("线下") !== -1 || platform.indexOf("商超") !== -1) return "商";
    return platform.slice(0, 1);
  }

  function renderOptionCard(item, onSelect) {
    var option = document.createElement("div");
    option.className = "option-card compact-option";
    option.setAttribute("role", "button");
    option.setAttribute("tabindex", "0");
    option.innerHTML = [
      "<span class=\"option-icon\"></span>",
      "<h3></h3>",
      "<span class=\"option-chevron\">›</span>"
    ].join("");
    option.querySelector(".option-icon").textContent = getOptionIcon(item.name);
    option.querySelector("h3").textContent = item.name;
    option.addEventListener("click", onSelect);
    option.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
      }
    });
    return option;
  }

  function getOptionIcon(name) {
    if (name.indexOf("家用") !== -1) return "⌂";
    if (name.indexOf("柔软") !== -1 || name.indexOf("厚实") !== -1) return "≈";
    if (name.indexOf("母婴") !== -1) return "♡";
    return "⌁";
  }

  function renderPriceTable(task) {
    var tableWrap = priceTableTemplate.content.cloneNode(true);
    var tbody = tableWrap.querySelector("tbody");
    task.priceResults.items.forEach(function (item, index) {
      var row = document.createElement("tr");
      if (index === 0) row.className = "is-recommended";
      row.innerHTML = [
        "<td class=\"platform-cell\"><span class=\"platform-name\"></span></td>",
        "<td></td>",
        "<td class=\"price-value\"></td>",
        "<td></td>",
        "<td></td>",
        "<td></td>",
        "<td><a class=\"table-link\" target=\"_blank\" rel=\"noopener\">打开看看</a></td>"
      ].join("");
      row.querySelector(".platform-name").textContent = item.platform;
      if (index === 0) {
        var badge = document.createElement("span");
        badge.className = "recommend-pill";
        badge.textContent = "推荐";
        row.children[0].appendChild(badge);
      }
      row.children[1].textContent = item.spec;
      row.children[2].textContent = item.estimatedPrice;
      row.children[3].textContent = item.unitPrice;
      row.children[4].textContent = item.discount;
      row.children[5].textContent = item.suggestion;
      row.children[6].querySelector("a").href = item.url;
      tbody.appendChild(row);
    });
    return tableWrap;
  }

  function openOverlay(name) {
    activeOverlay = name;
    menuOverlay.classList.toggle("hidden", name !== "menu");
    historyOverlay.classList.toggle("hidden", name !== "history");
    checklistOverlay.classList.toggle("hidden", name !== "checklist");
    menuOverlay.setAttribute("aria-hidden", name === "menu" ? "false" : "true");
    historyOverlay.setAttribute("aria-hidden", name === "history" ? "false" : "true");
    checklistOverlay.setAttribute("aria-hidden", name === "checklist" ? "false" : "true");
    document.body.classList.add("is-locked");
    renderAll();
  }

  function closeOverlay() {
    if (!activeOverlay) return;
    activeOverlay = null;
    menuOverlay.classList.add("hidden");
    historyOverlay.classList.add("hidden");
    checklistOverlay.classList.add("hidden");
    menuOverlay.setAttribute("aria-hidden", "true");
    historyOverlay.setAttribute("aria-hidden", "true");
    checklistOverlay.setAttribute("aria-hidden", "true");
    if (!activeQuestionTaskId) document.body.classList.remove("is-locked");
  }

  function renderHistory() {
    historyList.innerHTML = "";
    if (!tasks.length) {
      historyList.appendChild(emptyPanel("还没有历史记录。"));
      return;
    }

    tasks.forEach(function (task) {
      var item = document.createElement("article");
      item.className = "history-item";
      item.innerHTML = [
        "<h3></h3>",
        "<div class=\"meta-row\">",
        "<span class=\"pill status\"></span>",
        "<span class=\"pill time\"></span>",
        "<span class=\"pill checklist\"></span>",
        "</div>"
      ].join("");
      item.querySelector("h3").textContent = task.originalInput;
      item.querySelector(".status").textContent = statusLabel(task.status);
      item.querySelector(".time").textContent = formatTime(task.createdAt);
      item.querySelector(".checklist").textContent = checklistLabel(task.checklistStatus);

      var row = actionRow();
      row.appendChild(makeButton("恢复对话", "secondary-button", function () {
        currentTaskId = task.id;
        closeOverlay();
        showChat();
        renderChat();
      }));
      row.appendChild(makeButton("删除", "danger-button", function () {
        deleteTask(task.id);
      }));
      item.appendChild(row);
      historyList.appendChild(item);
    });
  }

  function renderChecklist() {
    checklistList.innerHTML = "";
    var items = tasks.filter(function (task) {
      return task.checklistStatus === "checked" || task.checklistStatus === "purchased";
    });

    if (!items.length) {
      checklistList.appendChild(emptyPanel("还没有加入清单的项目。"));
      return;
    }

    ["checked", "purchased"].forEach(function (status) {
      var groupItems = items.filter(function (task) {
        return task.checklistStatus === status;
      });
      if (!groupItems.length) return;

      var title = document.createElement("p");
      title.className = "muted";
      title.textContent = status === "checked" ? "待购买" : "已购买";
      checklistList.appendChild(title);

      groupItems.forEach(function (task) {
        var item = document.createElement("article");
        item.className = "checklist-item";
        item.innerHTML = [
          "<h3></h3>",
          "<p class=\"summary\"></p>",
          "<div class=\"meta-row\"><span class=\"pill\"></span></div>"
        ].join("");
        item.querySelector("h3").textContent = task.originalInput;
        item.querySelector(".summary").textContent = getPriceSummary(task);
        item.querySelector(".pill").textContent = "最近查价：" + getLastPriceTime(task);
        var row = actionRow();
        row.appendChild(makeButton("查看详情", "secondary-button", function () {
          currentTaskId = task.id;
          closeOverlay();
          showChat();
          renderChat();
        }));
        row.appendChild(makeButton("重新查价", "secondary-button", function () {
          currentTaskId = task.id;
          closeOverlay();
          showChat();
          searchPrice(task.id, task.selectedOption || getDefaultOption(task));
        }));
        row.appendChild(makeButton(task.checklistStatus === "purchased" ? "已购买" : "标记已购买", "secondary-button", function () {
          task.checklistStatus = task.checklistStatus === "purchased" ? "checked" : "purchased";
          saveTasks();
          renderAll();
        }));
        item.appendChild(row);
        checklistList.appendChild(item);
      });
    });
  }

  function openQuestionSheet(taskId) {
    activeQuestionTaskId = taskId;
    questionSheet.classList.remove("hidden");
    questionSheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    renderQuestionSheet();
  }

  function closeQuestionSheet() {
    if (!activeQuestionTaskId) return;
    activeQuestionTaskId = null;
    questionSheet.classList.add("hidden");
    questionSheet.setAttribute("aria-hidden", "true");
    if (!activeOverlay) document.body.classList.remove("is-locked");
  }

  function renderQuestionSheet() {
    var task = findTask(activeQuestionTaskId);
    questionForm.innerHTML = "";
    if (!task) return;

    var answers = getQuestionAnswers(task);
    (task.analysisResult.questions || []).forEach(function (question) {
      var group = document.createElement("section");
      group.className = "question-group";
      var heading = document.createElement("h3");
      heading.textContent = question.label;
      group.appendChild(heading);

      var row = document.createElement("div");
      row.className = "choice-row";
      question.options.forEach(function (option) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "choice-button" + (answers[question.id] === option ? " selected" : "");
        button.textContent = option;
        button.addEventListener("click", function () {
          setQuestionAnswer(task.id, question.id, option);
        });
        row.appendChild(button);
      });
      group.appendChild(row);
      questionForm.appendChild(group);
    });
  }

  function setQuestionAnswer(taskId, questionId, value) {
    var task = findTask(taskId);
    if (!task) return;
    var selected = ensureQuestionOption(task);
    selected.answers[questionId] = value;
    selected.generated = false;
    saveTasks();
    renderQuestionSheet();
  }

  function generateQuestionRecommendations() {
    var task = findTask(activeQuestionTaskId);
    if (!task) return;

    var answers = getQuestionAnswers(task);
    var missing = (task.analysisResult.questions || []).some(function (question) {
      return !answers[question.id];
    });
    if (missing) {
      showToast("先把这几个条件选完");
      return;
    }

    var selected = ensureQuestionOption(task);
    selected.generated = true;
    selected.recommendations = buildQuestionRecommendations(task);
    saveTasks();
    closeQuestionSheet();
    renderChat();
    scrollToResultStart(task.id, "recommendation");
  }

  function ensureQuestionOption(task) {
    if (!task.selectedOption || task.selectedOption.type !== "question_answers") {
      task.selectedOption = {
        type: "question_answers",
        answers: {},
        generated: false,
        recommendations: []
      };
    }
    task.selectedOption.answers = task.selectedOption.answers || {};
    task.selectedOption.recommendations = task.selectedOption.recommendations || [];
    return task.selectedOption;
  }

  function setSelectedOptionForPrice(task, option) {
    if (task.status === "need_questions") {
      var selected = ensureQuestionOption(task);
      selected.chosenRecommendation = option;
      selected.keyword = option.keyword;
      selected.name = option.name;
      return;
    }
    task.selectedOption = option;
  }

  function hasGeneratedQuestions(task) {
    return Boolean(task.selectedOption && task.selectedOption.type === "question_answers" && task.selectedOption.generated);
  }

  function getQuestionAnswers(task) {
    return task.selectedOption && task.selectedOption.answers ? task.selectedOption.answers : {};
  }

  function getQuestionRecommendations(task) {
    if (task.selectedOption && task.selectedOption.recommendations && task.selectedOption.recommendations.length) {
      return task.selectedOption.recommendations;
    }
    return buildQuestionRecommendations(task);
  }

  function getAnswerSummary(task) {
    var answers = getQuestionAnswers(task);
    return Object.keys(answers).map(function (key) {
      return answers[key];
    }).join(" / ");
  }

  function getSelectedName(task) {
    if (!task.selectedOption) return "这个方向";
    if (task.selectedOption.chosenRecommendation) return task.selectedOption.chosenRecommendation.name;
    return task.selectedOption.name || "这个方向";
  }

  function getDefaultOption(task) {
    if (task.analysisResult.priceKeyword) {
      return {
        name: "直接查价",
        keyword: task.analysisResult.priceKeyword
      };
    }
    if (task.analysisResult.recommendations && task.analysisResult.recommendations[0]) {
      return task.analysisResult.recommendations[0];
    }
    return getQuestionRecommendations(task)[0] || {
      name: "默认查价",
      keyword: task.originalInput
    };
  }

  function getTaskKeyword(task) {
    if (task.selectedOption && task.selectedOption.keyword) return task.selectedOption.keyword;
    if (task.selectedOption && task.selectedOption.chosenRecommendation) return task.selectedOption.chosenRecommendation.keyword;
    if (task.analysisResult.priceKeyword) return task.analysisResult.priceKeyword;
    return getDefaultOption(task).keyword || task.originalInput;
  }

  function buildQuestionRecommendations(task) {
    if (task.originalInput.indexOf("婴儿车") !== -1) {
      return [
        {
          name: "轻便可登机婴儿车",
          reason: "适合日常出门、老人帮带、收车频繁的家庭。",
          keyword: "轻便婴儿车 可坐可躺 618 补贴"
        },
        {
          name: "高景观双向婴儿车",
          reason: "适合新生儿、楼下散步多、对避震和舒适度更在意。",
          keyword: "高景观婴儿车 双向推行 618 补贴"
        },
        {
          name: "一车到三岁婴儿车",
          reason: "适合想少折腾、预算中等、希望覆盖更长周期。",
          keyword: "婴儿车 一车到三岁 可坐可躺"
        }
      ];
    }

    return [
      {
        name: "高性价比入门款",
        reason: "适合预算优先，先满足核心功能。",
        keyword: task.originalInput + " 高性价比 618 补贴"
      },
      {
        name: "中端均衡款",
        reason: "适合日常高频使用，兼顾体验和价格。",
        keyword: task.originalInput + " 中端 推荐 618"
      }
    ];
  }

  function makeAiCard(title) {
    var card = document.createElement("div");
    card.className = "ai-card";
    var heading = document.createElement("h2");
    heading.textContent = title;
    card.appendChild(heading);
    return card;
  }

  function markResultPanel(card, taskId, type) {
    card.classList.add("result-panel");
    card.dataset.scrollAnchor = "result-start";
    card.dataset.taskId = taskId;
    if (type) {
      card.classList.add(type + "-result-panel");
      card.dataset.resultType = type;
    }
  }

  function appendParagraph(parent, text) {
    var p = document.createElement("p");
    p.textContent = text;
    parent.appendChild(p);
  }

  function appendKeywordRow(parent, keyword) {
    var row = document.createElement("div");
    row.className = "keyword-row";
    var text = document.createElement("span");
    text.className = "keyword";
    text.textContent = keyword || "";
    row.appendChild(text);
    row.appendChild(makeButton("复制", "secondary-button", function () {
      copyText(keyword || "");
    }));
    parent.appendChild(row);
  }

  function actionRow() {
    var row = document.createElement("div");
    row.className = "action-row";
    return row;
  }

  function makeButton(label, className, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function makeLinkButton(label, href) {
    var link = document.createElement("a");
    link.className = "secondary-button";
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = label;
    return link;
  }

  function emptyPanel(text) {
    var node = document.createElement("div");
    node.className = "history-item";
    node.textContent = text;
    return node;
  }

  function deleteTask(taskId) {
    tasks = tasks.filter(function (task) {
      return task.id !== taskId;
    });
    if (currentTaskId === taskId) currentTaskId = tasks[0] ? tasks[0].id : null;
    saveTasks();
    renderAll();
    showToast("已删除");
  }

  async function postJson(url, body, fallback) {
    if (window.location.protocol === "file:") {
      return fallback();
    }

    try {
      var response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error("请求失败");
      return response.json();
    } catch (error) {
      return fallback();
    }
  }

  function normalizeAnalysisResponse(response, originalInput) {
    if (!response) return response;
    if (response.status) return response;

    var status = response.type || "need_recommendation";
    var normalized = {
      status: status,
      reason: response.reply || "",
      priceKeyword: response.query || "",
      recommendations: [],
      questions: []
    };

    if (status === "need_recommendation") {
      normalized.recommendations = (response.options || []).map(function (option) {
        return {
          id: option.id,
          name: option.name,
          audience: option.audience || "",
          brands: option.brands || "",
          keyword: option.query || option.keyword || originalInput
        };
      });
    }

    if (status === "need_questions") {
      normalized.questions = response.questions || [];
    }

    if (status === "direct_price_search" && !normalized.priceKeyword) {
      normalized.priceKeyword = originalInput;
    }

    return normalized;
  }

  function normalizePriceResponse(response, keyword) {
    if (!response) return response;
    if (response.items && response.items[0] && response.items[0].estimatedPrice) {
      return Object.assign({}, response, {
        debug: extractDebugInfo(response)
      });
    }

    return {
      keyword: response.query || keyword,
      notice: response.disclaimer || response.notice || "AI 查询价仅供参考，最终以打开页面为准。",
      summary: response.summary || "",
      debug: extractDebugInfo(response),
      items: (response.items || []).map(function (item) {
        return {
          platform: item.platform || "",
          tag: item.tag || "",
          spec: item.spec || "需确认规格",
          estimatedPrice: item.price || item.estimatedPrice || "需打开页面确认",
          unitPrice: item.unitPrice || "按规格确认",
          discount: item.discount || "需打开页面确认",
          suggestion: item.advice || item.suggestion || "价格和店铺资质需打开页面确认。",
          url: item.link || item.searchUrl || item.url || "#",
          linkText: item.linkText || "打开看看",
          needManualConfirm: true
        };
      })
    };
  }

  function logResponseSource(name, response) {
    var debug = extractDebugInfo(response);
    if (!debug.source) return;
    console.log(name + " debug:", debug);
  }

  function getDebugSourceText(priceResults) {
    var debug = extractDebugInfo(priceResults);
    var source = debug.source || "local_mock";
    var model = debug.modelUsed || "未配置";
    var search = debug.searchEnabled ? "是" : "否";
    var extractor = debug.extractorEnabled ? "是" : "否";
    var fallback = debug.isFallback ? "是" : "否";
    return [
      "数据来源：" + source,
      "调用模型：" + model,
      "apiMode：" + (debug.apiMode || "未知"),
      "searchEnabled：" + search,
      "extractorEnabled：" + extractor,
      "isFallback：" + fallback,
      "status：" + (debug.status || ""),
      "errorMessage：" + (debug.errorMessage || "")
    ].join("\n");
  }

  function extractDebugInfo(value) {
    if (!value) {
      return {
        provider: "",
        modelUsed: "",
        apiMode: "",
        searchEnabled: false,
        extractorEnabled: false,
        source: "",
        isFallback: false,
        errorMessage: "",
        status: null,
        errorCode: "",
        providerErrorCode: "",
        providerErrorMessage: ""
      };
    }
    var source = value && value.debug ? value.debug : value || {};
    return {
      provider: source.provider || "",
      modelUsed: source.modelUsed || "not_configured",
      apiMode: source.apiMode || "",
      searchEnabled: Boolean(source.searchEnabled),
      extractorEnabled: Boolean(source.extractorEnabled),
      source: source.source || "local_mock",
      isFallback: source.isFallback === undefined ? true : Boolean(source.isFallback),
      errorMessage: source.errorMessage || "",
      status: source.status || null,
      errorCode: source.errorCode || "",
      providerErrorCode: source.providerErrorCode || "",
      providerErrorMessage: source.providerErrorMessage || ""
    };
  }

  function localAnalyze(input) {
    var normalized = input.trim();
    if (normalized.indexOf("得宝") !== -1) {
      return Promise.resolve({
        status: "direct_price_search",
        reason: "你已经给出明确品牌，适合直接进入补贴价查询。",
        priceKeyword: "得宝 卷纸 27卷 618 补贴"
      });
    }

    if (normalized.indexOf("婴儿车") !== -1) {
      return Promise.resolve({
        status: "need_questions",
        reason: "婴儿车涉及年龄、使用场景、预算和收纳，先确认关键条件更合适。",
        questions: [
          { id: "age", label: "宝宝多大？", options: ["新生儿", "6个月以上", "1岁以上"] },
          { id: "scene", label: "主要怎么用？", options: ["小区散步", "经常出门", "旅行收纳"] },
          { id: "budget", label: "预算大概？", options: ["1000以内", "1000-2500", "2500以上"] }
        ]
      });
    }

    if (normalized.indexOf("卷纸") !== -1) {
      return Promise.resolve(toiletPaperRecommendations());
    }

    return Promise.resolve({
      status: "need_recommendation",
      reason: "你给的是品类需求，建议先选购买方向，再进入查价。",
      recommendations: [
        {
          name: "高性价比囤货款",
          audience: "预算优先、家里用量大、想趁 618 多囤一点",
          brands: "京东京造、维达、洁柔、蓝漂",
          keyword: normalized + " 高性价比 618 补贴"
        },
        {
          name: "品质稳妥款",
          audience: "给家人长期用，想少踩坑",
          brands: "维达、清风、心相印、得宝",
          keyword: normalized + " 品质款 618 补贴"
        }
      ]
    });
  }

  function toiletPaperRecommendations() {
    return {
      status: "need_recommendation",
      reason: "你想买卷纸但还没确定品牌和规格，先按使用偏好选类型。",
      recommendations: [
        {
          name: "家用性价比囤货装",
          audience: "一家人日常高频使用，想看单卷价",
          brands: "维达、洁柔、清风、京东京造",
          keyword: "卷纸 4层 加厚 24卷 27卷 618 补贴"
        },
        {
          name: "柔软厚实品质款",
          audience: "对手感、厚度、掉屑更敏感",
          brands: "得宝、心相印茶语、维达棉韧",
          keyword: "得宝 心相印 维达 棉韧 卷纸 618 补贴"
        },
        {
          name: "母婴家庭安心款",
          audience: "家里有宝宝或长辈，关注原生木浆和无香",
          brands: "可心柔、babycare、全棉时代",
          keyword: "母婴 卷纸 原生木浆 无香 618 补贴"
        }
      ]
    };
  }

  function localSearchPrice(keyword, originalInput, selectedOption) {
    var isPaper = (keyword || "").indexOf("卷纸") !== -1 || (originalInput || "").indexOf("卷纸") !== -1;
    return Promise.resolve({
      keyword: keyword || originalInput,
      notice: "AI 查询价仅供参考，最终以打开页面为准。",
      items: isPaper ? toiletPaperPrices() : generalPrices(keyword || originalInput, selectedOption)
    });
  }

  function toiletPaperPrices() {
    return [
      {
        platform: "京东",
        spec: "27卷装",
        estimatedPrice: "¥74.9-¥79.9",
        unitPrice: "¥2.77-¥2.96/卷",
        discount: "PLUS会员95折+满减+品牌券",
        suggestion: "首选，物流快，售后好。",
        url: "https://www.jd.com/",
        needManualConfirm: true
      },
      {
        platform: "天猫/淘宝",
        spec: "24-27卷装",
        estimatedPrice: "¥72-¥85",
        unitPrice: "¥2.67-¥3.15/卷",
        discount: "店铺券+跨店满减+88VIP",
        suggestion: "品牌旗舰店更稳，注意是否同规格同层数。",
        url: "https://www.taobao.com/",
        needManualConfirm: true
      },
      {
        platform: "拼多多",
        spec: "24卷装",
        estimatedPrice: "¥65-¥69",
        unitPrice: "¥2.70-¥2.87/卷",
        discount: "百亿补贴+平台券",
        suggestion: "追求低价可选，需要确认店铺资质。",
        url: "https://www.pinduoduo.com/",
        needManualConfirm: true
      },
      {
        platform: "线下商超",
        spec: "10-18卷装",
        estimatedPrice: "¥39.9-¥69.9",
        unitPrice: "¥3.20-¥4.20/卷",
        discount: "会员价+门店满减",
        suggestion: "适合临时补货，囤货价通常不如线上。",
        url: "https://map.baidu.com/",
        needManualConfirm: true
      }
    ];
  }

  function generalPrices(keyword) {
    return [
      {
        platform: "京东",
        spec: "主流热卖规格",
        estimatedPrice: "¥199-¥239",
        unitPrice: "按规格确认",
        discount: "PLUS会员价+满减+品类券",
        suggestion: "适合看自营和售后，先确认型号一致。",
        url: "https://www.jd.com/",
        needManualConfirm: true
      },
      {
        platform: "天猫/淘宝",
        spec: "旗舰店常规规格",
        estimatedPrice: "¥189-¥249",
        unitPrice: "按规格确认",
        discount: "店铺券+跨店满减",
        suggestion: "适合看旗舰店活动，注意赠品是否计入价格。",
        url: "https://www.taobao.com/",
        needManualConfirm: true
      },
      {
        platform: "拼多多",
        spec: "补贴款规格",
        estimatedPrice: "¥179-¥229",
        unitPrice: "按规格确认",
        discount: "百亿补贴+平台券",
        suggestion: "低价优先可看，重点确认店铺和售后。",
        url: "https://www.pinduoduo.com/",
        needManualConfirm: true
      }
    ];
  }

  function getPriceSummary(task) {
    if (!task.priceResults || !task.priceResults.items || !task.priceResults.items.length) {
      return "还没有查价结果";
    }
    var best = task.priceResults.items[0];
    return best.platform + "：" + best.estimatedPrice + "，" + best.suggestion;
  }

  function getLastPriceTime(task) {
    if (task.priceResults && task.priceResults.searchedAt) return formatTime(task.priceResults.searchedAt);
    return "未查价";
  }

  function setSubmitting(isSubmitting) {
    homeSendBtn.disabled = isSubmitting;
    chatSendBtn.disabled = isSubmitting;
  }

  function updateSendState() {
    homeSendBtn.classList.toggle("is-ready", Boolean(homeInput.value.trim()));
    chatSendBtn.classList.toggle("is-ready", Boolean(chatInput.value.trim()));
  }

  function autoResize(input) {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
    updateSendState();
  }

  function scrollChatToBottom() {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function scrollToResultStart(taskId, type) {
    window.requestAnimationFrame(function () {
      var selector = ".result-panel[data-task-id=\"" + taskId + "\"]";
      if (type) selector += "[data-result-type=\"" + type + "\"]";
      var panel = chatStream.querySelector(selector);
      if (!panel) {
        scrollChatToBottom();
        return;
      }

      var panelRect = panel.getBoundingClientRect();
      var scrollRect = chatScroll.getBoundingClientRect();
      var scrollTop = chatScroll.scrollTop + panelRect.top - scrollRect.top - 8;
      chatScroll.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: "smooth"
      });
    });
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast("已复制");
      });
      return;
    }
    var temp = document.createElement("textarea");
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    showToast("已复制");
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(tasks, null, 2)], {
      type: "application/json"
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "ai-price-list-tasks.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("JSON 已导出");
  }

  function loadTasks() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }

  function getCurrentTask() {
    return findTask(currentTaskId);
  }

  function findTask(id) {
    return tasks.find(function (task) {
      return task.id === id;
    });
  }

  function makeId() {
    return "task_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function statusLabel(status) {
    var labels = {
      direct_price_search: "可以直接查价",
      need_recommendation: "先帮你选品",
      need_questions: "先确认条件"
    };
    return labels[status] || "待处理";
  }

  function checklistLabel(status) {
    var labels = {
      pending: "未加入清单",
      checked: "已加入清单",
      purchased: "已购买"
    };
    return labels[status] || "未加入清单";
  }

  function formatTime(value) {
    try {
      return new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (error) {
      return "";
    }
  }

  function showToast(message) {
    var old = document.querySelector(".toast");
    if (old) old.remove();

    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () {
      toast.remove();
    }, 2200);
  }
})();
