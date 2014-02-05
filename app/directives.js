angular.module('wmCollector.directives', [])
  .directive('verifySrc', function () {
    return {
      restrict: 'A',
      link: function (scope, element, attrs) {
        var elPreloader = angular.element('<img>');

        elPreloader.on('load', function () {
          element.attr('src', attrs.verifySrc);
        });

        elPreloader.attr('src', attrs.verifySrc);
      }
    };
  })
  .directive('tabswitcher', function () {
    return {
      restrict: 'AE',
      priority: 1,
      link: function (scope, element, attrs) {
        var elTriggers = element.children();
        var elTabbedContent = $('tabbed[group=' + attrs.control + ']');
        var elPanels = elTabbedContent.children();

        function showPanel(index) {
          elPanels.hide();
          elPanels.eq(index).show();
          elTriggers.filter('.btn-primary').removeClass('btn-primary');
          elTriggers.eq(index).addClass('btn-primary');
        }

        elPanels.each(function (index, elPanel) {
          $(elPanel).hide();
        });

        elTriggers.on('click', function (event) {
          showPanel($(this).index());
        });

        showPanel(0);
      }
    };
  });
