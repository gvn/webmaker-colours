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
        var elTriggers = element[0].children;
        var elTabbedContent = document.querySelectorAll('tabbed[group=' + attrs.control + ']')[0];
        var elPanels = elTabbedContent.children;

        angular.forEach(elPanels, function (elPanel) {
          console.log(elPanel);
          elPanel.style.display = 'none';
        });

        angular.forEach(elTriggers, function (elTrigger) {
          elTrigger.addEventListener('click', function (event) {
            console.log(event);
          });
        });
      }
    };
  });
