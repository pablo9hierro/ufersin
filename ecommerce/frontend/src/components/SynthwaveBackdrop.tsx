import './SynthwaveBackdrop.css'

// Mesmo PNG (base64) usado nos dois morros da referência — só espelhado
// via CSS (scaleX(-1) no #hill2). Definido uma vez só pra não duplicar
// uma string de ~3kb no bundle.
const HILL_PNG =
  'data:img/png;base64,iVBORw0KGgoAAAANSUhEUgAAAcUAAAGACAQAAAB2XbHQAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAAmJLR0QA/4ePzL8AAAAHdElNRQfpAg0TExlu0Z8sAAARxUlEQVR42u3deZSW5X3G8es3AwMMw7AIRhCpyo5SF/YoRlFRtI6ogAhRg4DEJYYCxq3RJI3W5pwsR7TaRjGLKRUVijHa2EiNG/GoMYqaYxUjjY0mbU9PzjHnVHPat3+4IDjDvMvzPL/7vp/v5y91Fq4Huea6X97NKgLKw4aqXe3qr//R23pLv60EUwALJgmQGxuo2TpaE3Ww+u/ygXf0kp7TY3q4st09I1VEymyQFmm+Pqke3Xzii7pH3/MsJFVEsmycVuls9a76Cyraoht1b+X/XNJSRaTIhuoaLe12CzvzS31V/1B8HakikmO9dKVWqa2Bb/Gs1lS2FJyaKiItNlm36+AMvtFdWlV5o7jcTcX9UkDerKd9WVszKaI0Xy/YcrPCsrOKSIXtqzt1RMbf9H6dV/ltIempItJgU/WPGprDN35LCys/zT8/B1QkwRbop7kUUdpHP7HV+R9UWUUkwC7SDTnPygadV/lDrtdAFRE7u1LXFvDLPKWOylv5fXsOqIicfbGQIkpT9ISNz/E6WEXEzC7XXxX4y/23Tqk8ntOVUEXEyy7W2oJ/yT9obuUnuVwLVUSs7DNap8Lugv/QO5pf+WEOV0MVESfr0EY1u/zSf9Siyt2ZXw9VRIxsln5Uw9OfsvauFlQ2Z3xFVBHxsYl6dLfn4xftXZ1WuT/Ta6KKiI0N05Ma7p1C7+ikLJ9Ixf2KiIy1amMARZR6aZNNy+7bUUVExUzfVYYFaEi7fmgTsvpmVBFx+bLmeUf4iCH6sWW00NxWRETsNN3jcE/inm3TzMrvM7g2qohY2Hj9TO3eKTqxRXMq7zb6TTigIhLWpk1BFlGapXWNP5+RKiIWt2isd4QuLdZ1jX4LDqiIgi3Vrd4ZunFh5eaGrpAqInw2QU+p1TtFN/5Xsxu5y58qInjWU1s1yTtFFX6vmZVt9X4xtxURvmuiKKLUX/fXfy8jq4jA2TQ97vRkqHrUfS8jq4igWYtui6iI0kRttJZ6vpAqImxX6SDvCDWq815GDqgImI3XL1TXxji7vnJFrV/CKiJYZropyiJKl9sXa/0SqohwnaVjvCPU7St2aW1fwAEVgbK+eln7eqdoyJ9XvlX9J7OKCNWlkRdR+oatrv6TWUUEyYbpleAf6laNKytVvno5q4gwXZNEEaXr7JrqPpFVRIBslH6pHt4pMvN1XVrptmisIkL0pYSKKK3WLdbtI4ZYRQTHxuql5EZivc6t/HFPn5DaBSMFlyf45/Is3WN7fGMBVhGBsf31SlLH05226NTK2119ML2fPojdqkSLKM3SP9vArj7IKiIoNkC/Vpt3ihw9qxMrv+vsA6wiwrIs6SJKh+lhG9bZB1hFBMRMr2ikd4rcbdexlR27/0dWESE5rgRFlEbqERu9+3+kigjJCu8ABRmhR2y3VyfggIpg2FDtUE/vFIX5T51Q+fnOf2UVEY4lJSqiNFgP2Yyd/8oqIhBmelUHeqco2NuaU3nsvX9kFRGKI0pXRKlND9iR7/0jVUQoFnkHcPFhGTmgIgjWU7/RYO8UTt7WnMpjrCLCMLu0RZTadJ9NpYoIw2LvAK76634OqAiA9dF/qK93Cl+sIkJwYtmLSBURhtO9A/jjgAp31qLfqb93Cm+sIvwdSxGpIkJwhneAEHBAhTNr0pva2zuFP1YR3mZQRIkqwt8p3gHCQBXh7VTvAGHgtiJc2Ri97J0hDKwifHE8fR9VhC+Op+/jgApHNkRvqtu3OysHVhGeTqKIH6CK8DTXO0A4OKDCDc9S/ChWEX6Oo4g7UUX46fAOEBIOqHDCw8B3xSrCy3SK+FFUEV64c38XVBFeuKW4C6oIFzZO47wzhIUqwgebuBuqCB/zvAOEhjsz4MD212sy7xRhYRXhYT5F3B1VhIcF3gHCwwEVhbMD9Jp3hvCwiigem9gJqojizfcOECIOqCiYTdCL3hlCxCqiaOd4BwgTq4hCWZN2aLh3ihCxiijWLIrYOaqIYp3tHSBUHFBRIOurt9TmnSJMrCKKdAZF7ApVRJGWewcIFwdUFMYO1jbvDOFiFVGcFd4BQsYqoiDWV29ogHeKcLGKKMqZFHFPqCKK8lnvAGHjgIpC2CQ97Z0hbKwiinGRd4DQsYoogA3V62rxThE2VhFFuJAidodVRO6sTa9rL+8UoWMVkb8lFLF7rCJyZk16WaO8U4SPVUTe5lLEarCKyJlt1XTvDDFgFZErO4IiVocqIl+XeQeIBQdU5MgO0jbeqKY6rCLydBlFrBariNzYCG1XD+8UsWAVkZ81FLF6rCJyYoO1Q63eKeLBKiIvn6OItWAVkQtr0w4N8k4RE1YR+VhOEWvDKiIH1qJXtZ93iriwisjDIopYK1YRmbMmvaDx3iliwyoiex0UsXasIjJnP9M07wzxYRWRMTuGItaDKiJrV3gHiBMHVGSKVwGvF6uIbLGJdWIVkSEbq5f48V4fftuQpcv4E1UvVhGZsf30Ki/IXy9+hiE7qyli/VhFZMQG63X19U4RL1YRWfk8RWwEq4hM2ED9Sv29U8SMVUQ21lDExrCKyIAN0Xb1804RN1YRWVhDERvFKqJhNkIvq7d3itiximjc9RSxcawiGmTTtJV3xmgcq4iGWLPWUsQsUEU0ZqWmeEdIAwdUNMBG6zn18U6RBlYRdbMW3UERs0IVUb+bNNU7QjqoIupkF2iZd4aUcFsRdbElupUf5FniNxN1sGUUMWv8dqJG1sP+Wt/mT07WeK901MRGa52O9E6RIn62oWrWy67R8xQxH6wiqmLNWqSrNco7R7qoIrplPbRAV2usd460UUXskQ3U+bqI9xDOH1VEl2ySVmgRr+NWDKqITli7ztL5Otw7R5lQRezCTDO1RPPU5p2kbKgiPmTDtFTnaqR3jnKiipBkvdShz+gENXsnKS+qWHp2qJZqkQZ55yg7qlhi1keLtUKTvXNAooqlZf10iVZqsHcOfIAqlpD10iqt4UgaFqpYOnayvsVjScNDFUvF2rVW53inQGeoYonYYdqo/b1ToHM8X7E0bJ4epYjhooolYefrTh7YHTKqWAq2Qrfw/zpsvPhiCViHNvKQttBRxeTZBD2lVu8U6A6HlsRZX91NEWNAFVN3rcZ7R0A1OKAmzabrcX7cxoEqJsxMT/JGpLHgJ2bKFlLEeLCKybJmvchrl8aDVUzXGRQxJqxisuwZXjwxJqxiomwGRYwLVUzVRd4BUBsOqEmyIXpDLd4pUAtWMU1LKWJsWMUEWZNe0YHeKVAbVjFFx1LE+FDFFK3wDoDacUBNjo3Qdl4+LD6sYno+RxFjxComxtr0aw3wToHasYqpOY8ixolVTIr11qva1zsF6sEqpuViihgrVjEhNkT/yvE0VqxiSr5BEePFKibDOrTZOwPqRxUTYfvp57yHcMw4oCbBWnU3RYwbVUyANWu9pnqnQGOoYvSsWd9Xh3cKNIpHK0bO2vQDipgCqhg1G6lNmuidAlnggBoxW6inKWIqqGKkbIRt1nru0k8HB9QIWbu+oFXq450DWaKKkbG9tFIXaaB3DmSNKkbEpuuzWsAapokqRsEmaJ4W6CDvHMgPVQyatepTOl4naIJ3EuSNKgbJ9tV0zdBUTVUv7ywoBlUMiPXTNE3RVE3hufjlQxUDYIN0tGZqpg5Vs3cWeKGKjqxJk3Si5mgqFQRVdGGDNEdzNFtDvJMgFFSxYNauU7VAJ6indxKEhSoWxlr1ZzpTc7iLHp2higUw00wt0Ty1eSdBuKhizmywlmi5RnvnQOioYo5sii7WAvX2zoEYUMVcmOkkrdYx3jkQD6qYOeulT2sVjxpFbahipqyPLtQqDfPOgfhQxcxYL63QFdrHOwfiRBUzYS06T1dpuHcOxIsqNsxMC3Wd9vfOgbhRxQbZdH1T071TIH68+GIDbIT9vZ6giMgCq1gna9EXdCWPJ0VWqGJd7HjdqDHeKZASDqg1s2F2px6kiMgWVayJmS3Vi1rgnQPp4YBaAztQ39Ys7xRIE6tYJWuyldpGEZEXVrEqdoBu16e8UyBlrGK3zOx8PUcRkS9WsRs2VLdpjncKpI9V3CObrxcoIopAFbtkA+wObdAg7xwoBw6oXbDjtE77eadAebCKnbCB9nd6kCKiSKzix9hifV2f8E6BsqGKu7BRulnHeadAGVHF91kvTdUSLVaLdxKUU8mraJ/QAh2vSdqHW83wVeIq2jFaqZN5Z0OEoaRVtCP1Nc3wTgHsVMJjmY2zjXqUIiIsJVtF669rtaJsV40YlOoPpZ2utbyIPsJUmiraQK3VYu8UQFdKUkWbqR/wQDaErAR/bWNNdpW2UESELflVtHbdoVO8UwDdSbyKNkr3arx3CqB7SVfRDtE/8X6HiEPCtxXtCD1MERGLZKtoJ+lBDfBOAVQr0Spahzap1TsFUD2reCfI46KO0gMUEXFJsIo2Uk9qL+8UQG2SO6BaqzZRRMQnuSrqOk30jgDULrEDqn1Sj8m8UwC1S20Vr6eIiFNSq2iT9LR3BqA+aa3iMu8AQL0SWkXrpTc10DsFUJ+UVnE2RUS8Uqpih3cAoH7JHFCtSb/hTWcQr3RWcTJFRMzSqeJs7wBAI6giEIREbitaP/2XenqnAOqXyioeQxERt1SqyPEUkUvlgPqaDvDOADQiiVW0wygiYpdEFTXPOwDQqAQOqNZD2zXCOwXQmBRW8XSKiPilUMVLvAMAjYu+ijZXR3hnABoX+W1Fa9cLvHMiUhD1Klqzvk8RkYaoq6gbeLowUhFtFa3Z1upC7xRAViJ9q1Mbo+9ohncKIDsRrqINt5u0jSIiLVGtoplmapnOVIt3EiBr0VTRhmuxztMY7xxAPiKoovXXPH1aR8V4mAaqFXQVzXS0lup09fFOAuQt2Cpau5brAo30zgEUI8gq2gCt0ufV7p0DKE5wVbQeOl9f4S28UTaBVdHG6Hua5p0CKF5QfytpZ+pZiohyCqiK9hdar1bvFICPYKpoX9JfyrxTAF4CeeqwXaC/8c4AeAqiinak/iW0v0ACihVAFa1Nz/OSwii7EG4rXksRAfdVtPF6nsMp4L+KX6WIgPsq2kQ9x10YgP8qrqGIgOS8ijZY/8ZzEQHJexXPpYjAe3xX8QUd5P0bAITBcRVtMkUEPuB5QD3H++KBcLgdUK2n/l1DvC8fCIXfKp5MEYGd/Kq41PvSgZA4HVBthH7l/vACICBedbiEIgIf5bKKtpdeV5v3pQMh8dmmqykisCuHVbTD9SRPjAJ2VXgVrVXPaJz3ZQOhKfiAai3aTBGBjyu0ijZQ9+s470sGQlRgFe0U/ULHel8wEKaCqmh/ag/oXo3wvlwgVAVU0YbabXpWJ3pfKhCynO9UsCat0HUa4H2ZQOhyraKN1e2a4X2JQAxyPKDacj1DEYHq5LSK1qZ1mu99cUA8cqmi/Yk26xDvSwNikkMVbYru097eFwbEJfPbina0tlBEoFYZr6IdrR+p1fuigPhk+swMm6SH1N/7koAYZVhFG66tGu59QUCcMrutaK3aTBGBemX31zY36HDviwHildEB1RZqvfelADHLpIo2TNs0yPtSgJhlc0C9kSICjcmgina2TvO+DCB2DR9QbaKe4FVNgUY1uIo2Sj+miEDjGqqijdNDGup9CUAKGqiiTdYjvHAUkI26q2in6WHerBTISl1VNLMrdLf6eocH0lHHk6Ssv76jud7BgbTUXEU7RHdptHdsIDU1HlDtHD1BEYHs1VBF62N/q+/yHH0gD1UfUG28Nuhg77hAqqpcRVuipykikJ8qVtH66WYt9g4KpK3bKtqh2sBf1AB56+aAahdqK0UE8reHVbR23cr7XgDF6LKKNlkbdIB3PKAsujig2hI9ShGB4nRSRetpN2qdentHA8rkYwdU21t36SjvWEDZ7FZFO5zX+AY87HJAtdl6mCICHj5SRVuo+9TPOxBQTh8eUG2h7lCzdxygrN5/HVSbpQfU4h0GKC+rSLL99ZQGe0cByuy924o3U0TAl1VkB2ubdwyg7JokzfQOAaBJ0kTvEACaJI30DgGgSdLe3iEANEm8FxTgz9Ssd3iUDeCtSYMpIuDv/wGy50R6ga7BfQAAAABJRU5ErkJggg=='

// Path do coqueiro (inline SVG) — mesmo path em #tree e #tree2, só
// espelhado via CSS (scaleX(-1) no #tree2).
const TREE_PATH =
  'm 155.60965,35.459235 c -0.0814,0.008 -0.31512,0.299173 -0.78443,0.882632 -1.7494,2.17484 -3.447,4.9281 -4.54187,7.365971 -0.88828,1.977919 -1.69331,4.417089 -2.0257,6.138648 -0.0809,0.4191 -0.16343,0.814411 -0.18243,0.879001 -0.0196,0.0647 -0.34327,-0.33465 -0.72036,-0.88882 -3.166,-4.652722 -7.95419,-8.60562 -11.96879,-9.880542 -1.66259,-0.528 -2.18504,-0.606189 -4.06435,-0.607189 -1.2941,0 -1.87949,0.0348 -2.48459,0.152421 -4.0318,0.784151 -8.02201,3.218339 -11.87681,7.245559 l -1.08984,1.13896 -4.95805,5.473141 c 1.89642,-0.39947 3.7248,-1.168691 5.65621,-1.37882 0.89619,-0.0976 4.56115,-0.121531 5.80326,-0.0377 0.52567,0.0354 1.61168,0.17661 2.41379,0.31369 4.62079,0.7897 8.39399,2.650941 11.32438,5.585691 0.7162,0.71721 4.0155,4.734561 3.9455,4.804361 -0.0148,0.01479 -0.34812,-0.0159 -0.74002,-0.0687 -0.90569,-0.121999 -3.11983,-0.0447 -3.97184,0.13902 -1.01039,0.21785 -2.58316,0.771552 -3.59566,1.265552 -1.41359,0.689719 -3.46382,2.0964 -4.18733,2.873219 l -0.20515,0.22066 0.62838,0.004 c 3.4857,0.0222 8.13279,0.893001 10.88718,2.039681 l 0.65011,0.270241 -0.9271,0.266149 c -2.76789,0.794618 -5.83965,2.274959 -7.87495,3.794599 -4.5692,3.411511 -8.52292,9.364469 -11.65252,17.544139 -0.5003,1.307532 -1.19988,3.36441 -1.53429,4.510842 -0.14409,0.49421 -0.15486,0.492779 0.45424,0.0584 4.1248,-2.941601 9.74902,-5.96596 13.46224,-7.239331 0.5821,-0.199628 1.08738,-0.38712 1.12138,-0.41651 0.0661,-0.0563 -0.70718,-3.25411 -1.4945,-6.181539 -0.2563,-0.95286 -0.45321,-1.74448 -0.4382,-1.75959 0.0386,-0.0386 1.12895,1.64973 1.65364,2.56056 0.5329,0.92514 1.18026,2.26509 1.78025,3.6835 0.2463,0.582092 0.47443,1.08744 0.50644,1.12345 0.0322,0.036 0.32242,0.01011 0.64492,-0.0579 1.15589,-0.243051 3.03943,-0.322421 4.42143,-0.18657 0.4355,0.0429 0.52554,0.0299 0.52554,-0.0765 0,-0.66117 -1.63663,-6.974473 -2.83083,-10.920262 l -0.12816,-0.42322 0.25632,0.29609 c 0.141,0.162992 0.51594,0.677421 0.83355,1.14308 1.7662,2.589429 3.02604,5.152551 4.20282,8.55141 l 0.52764,1.523949 1.41695,-0.0269 c 1.34061,-0.02569 1.41356,-0.019 1.35755,0.126632 -0.0326,0.0847 -0.30234,0.99246 -0.59944,2.016908 -2.8502,9.827227 -5.06434,19.827962 -6.85075,30.945402 -0.6835,4.25393 -1.92657,12.66834 -2.54506,17.22997 -0.12001,0.88476 -0.27141,1.98948 -0.33642,2.45515 -0.0652,0.46566 -0.15978,1.15138 -0.20878,1.52393 -0.33218,2.5039 -0.43201,3.26675 -0.47799,3.64062 -0.0284,0.23283 -0.24892,1.98562 -0.49041,3.89484 l -0.43926,3.47113 -0.84439,0.0153 c -28.84504,4.49091 -40.188808,24.98454 -17.30841,25.768 l 38.19237,-0.0616 c 33.41732,-0.10707 -1.30485,-24.46415 -13.72317,-25.73324 -0.0303,-0.0286 0.23651,-3.44618 0.3824,-4.89893 0.0188,-0.1863 0.13047,-1.36735 0.24858,-2.62465 0.11818,-1.2573 0.2726,-2.85735 0.3426,-3.55585 0.0702,-0.6985 0.16587,-1.651 0.21188,-2.11667 1.3997,-14.08029 3.19511,-25.08541 6.60321,-40.470935 0.19661,-0.88794 0.41696,-1.678089 0.49197,-1.763708 0.0873,-0.0999 0.15523,-0.401979 0.19222,-0.84696 0.0674,-0.82196 0.96014,-4.561258 1.17564,-4.924769 0.0828,-0.1397 0.21879,-0.47231 0.30179,-0.739481 0.0831,-0.267208 0.16597,-0.470991 0.18396,-0.45271 0.0539,0.0538 0.32266,2.325481 0.57156,4.832781 0.027,0.2794 0.0658,0.641609 0.0847,0.804619 0.0193,0.162959 0.0763,0.75324 0.12661,1.31204 0.0503,0.5588 0.10617,1.149618 0.12454,1.312598 0.0185,0.16299 0.0577,0.60107 0.0873,0.97359 0.0295,0.37253 0.0672,0.772405 0.0832,0.888815 0.0161,0.11645 0.0528,0.51685 0.0822,0.88937 0.0294,0.37254 0.07,0.86786 0.0899,1.1007 0.0199,0.23284 0.0772,0.91858 0.12767,1.52394 0.0504,0.60537 0.10718,1.23384 0.12607,1.39682 0.019,0.16298 0.0357,0.48366 0.0377,0.7126 0.003,0.22897 0.0212,0.39844 0.0429,0.37674 0.0651,-0.0651 0.61052,-2.88158 0.88315,-4.56046 0.5393,-3.320925 0.73829,-5.114853 0.93379,-8.424282 l 0.0548,-0.93173 0.23567,0.50797 c 0.38584,0.8318 1.44256,3.536099 1.99625,5.108727 1.56298,4.439465 3.10028,10.476105 3.90311,15.327775 0.13385,0.80889 0.2585,1.4858 0.27699,1.50429 0.0789,0.0789 0.51149,-3.14339 0.60979,-4.54131 0.0279,-0.39584 0.0818,-1.15793 0.11988,-1.69344 0.21212,-2.98285 0.17182,-10.011205 -0.0811,-14.139713 -0.16777,-2.73806 -0.16912,-2.76124 -0.29147,-4.190969 -0.35277,-4.122901 -0.54448,-5.90841 -0.93998,-8.76019 -0.16447,-1.185891 -0.27766,-2.24065 -0.25167,-2.344031 0.0729,-0.29051 1.32789,-1.562229 1.85364,-1.87843 1.36005,-0.81802 4.33267,-1.704369 5.71954,-1.70638 0.27051,0 0.24389,0.0259 -0.44495,0.44392 -0.40296,0.24447 -0.96901,0.616241 -1.2578,0.825791 -0.75663,0.54904 -2.13937,1.951379 -2.7962,2.83599 -0.68828,0.926938 -1.63681,2.57093 -1.53531,2.66134 0.0406,0.0361 0.51196,0.42132 1.04747,0.855761 1.14853,0.931788 3.72153,3.107798 5.03794,4.260717 0.51225,0.448601 0.95027,0.81439 0.97358,0.813382 0.0233,0 0.1641,-0.202911 0.31266,-0.44854 0.53192,-0.87953 1.67727,-2.2378 2.97863,-3.53156 0.72779,-0.72358 1.45653,-1.408509 1.61954,-1.52241 l 0.29609,-0.207222 -0.16536,0.252701 c -1.06977,1.63177 -1.74853,2.900522 -2.37091,4.4328 -0.44354,1.09197 -0.92056,2.513441 -0.88005,2.622082 0.0161,0.0436 0.77107,0.759859 1.6774,1.591627 0.90636,0.831771 2.2316,2.079411 2.94452,2.772961 0.71295,0.693531 1.30919,1.24614 1.32501,1.22783 0.0159,-0.01831 0.15229,-0.35711 0.30332,-0.75293 0.45466,-1.191469 1.24756,-2.936949 1.88515,-4.148579 0.62318,-1.184201 0.9711,-1.77483 0.87231,-1.481571 -0.68051,2.020181 -1.36181,5.164621 -1.60869,7.42434 l -0.0527,0.48165 0.79997,0.872808 c 1.23341,1.34575 2.57776,2.934285 3.80492,4.497395 l 1.11726,1.4237 0.10128,-1.04233 c 0.12941,-1.33186 0.43947,-3.831885 0.52295,-4.217305 0.0404,-0.18658 0.0857,0.42489 0.12247,1.651065 0.0322,1.07102 0.078,2.13756 0.10234,2.37039 0.0243,0.23284 0.10263,0.95193 0.17362,1.59786 l 0.12867,1.17458 1.46502,2.21229 c 2.22327,3.35745 3.43853,5.44158 4.89376,8.39277 0.51885,1.05219 0.81828,1.58094 0.79119,1.39681 -0.0241,-0.16298 -0.0847,-0.67741 -0.13539,-1.1431 -0.17867,-1.64093 -0.79161,-5.89289 -1.09813,-7.61969 -0.38613,-2.17515 -0.56295,-3.11938 -0.89609,-4.78368 -1.85409,-9.263344 -4.36822,-17.216713 -7.29308,-23.071971 -1.95416,-3.912021 -4.22762,-7.061912 -6.51692,-9.028401 -1.23299,-1.05913 -3.23311,-2.36718 -4.78264,-3.128492 l -0.56742,-0.279048 0.24444,-0.148301 c 0.38775,-0.235829 2.24248,-1.03545 3.26957,-1.409759 1.91468,-0.697762 4.8614,-1.453779 6.84969,-1.756992 1.47677,-0.225189 1.43602,-0.193569 0.8537,-0.650608 -0.27196,-0.213442 -0.86315,-0.58089 -1.3136,-0.81648 -2.74942,-1.43782 -6.08401,-2.092561 -10.61022,-2.082561 -0.82655,0.003 -1.50275,-0.006 -1.50275,-0.0169 0,-0.0114 0.24157,-0.39391 0.53692,-0.85006 0.70646,-1.09111 1.45822,-2.3595 2.47375,-4.1739 0.91921,-1.64235 1.08148,-1.90744 2.18024,-3.55587 1.54192,-2.313281 3.49568,-4.795549 5.72109,-7.269321 1.2346,-1.37237 4.51038,-4.669319 5.58054,-5.61671 l 0.53329,-0.472329 -0.74517,-0.13486 c -1.68124,-0.304351 -2.90039,-0.410581 -5.02036,-0.4372 -2.46679,-0.031 -3.48848,0.0406 -5.56451,0.389651 -5.15739,0.867069 -9.75521,3.25814 -13.1687,6.848161 -2.03155,2.136589 -4.24087,5.271428 -5.62033,7.974198 l -0.40463,0.79272 -0.0569,-0.67697 c -0.0312,-0.37256 -0.0815,-0.98242 -0.1116,-1.354951 -0.094,-1.161999 -0.12845,-6.142519 -0.0481,-6.942748 0.19267,-1.91728 0.27945,-2.633581 0.47698,-3.936712 0.23537,-1.552869 0.7482,-4.110299 1.1162,-5.566069 0.13951,-0.55186 0.21063,-0.827899 0.1292,-0.820099 z'

function SynthwaveHill({ mirrored }: { mirrored?: boolean }) {
  return (
    <div className={mirrored ? 'sunset-sw-hill2' : 'sunset-sw-hill'}>
      <svg xmlns="http://www.w3.org/2000/svg" width="453px" height="384px">
        <image x="0px" y="0px" width="453px" height="384px" xlinkHref={HILL_PNG} />
      </svg>
    </div>
  )
}

function SynthwaveTree({ mirrored }: { mirrored?: boolean }) {
  return (
    <div className={mirrored ? 'sunset-sw-tree2' : 'sunset-sw-tree'}>
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 210 297">
        <g>
          <g transform="translate(-42.308637,41.647565)">
            <path style={{ fill: '#190a21', strokeWidth: 0.08466667 }} d={TREE_PATH} />
          </g>
        </g>
      </svg>
    </div>
  )
}

// Uiverse.io by BlackisPlay — ver SynthwaveBackdrop.css pra explicação
// da adaptação (id -> class, mesmo prefixo/grafia).
export default function SynthwaveBackdrop() {
  return (
    <div className="sunset-sw-root">
      <div className="sunset-sw-stars">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className={`sunset-sw-star${i}`} />
        ))}
      </div>
      <div className="sunset-sw-sun">
        <div className="sunset-sw-ball" />
        <div className="sunset-sw-stripe0" />
        <div className="sunset-sw-stripe1" />
        <div className="sunset-sw-stripe2" />
        <div className="sunset-sw-stripe3" />
        <div className="sunset-sw-stripe4" />
        <div className="sunset-sw-stripe5" />
        <div className="sunset-sw-stripe6" />
        <div className="sunset-sw-stripe7" />
      </div>
      <SynthwaveHill />
      <SynthwaveHill mirrored />
      <SynthwaveTree />
      <SynthwaveTree mirrored />
      <div className="sunset-sw-fog" />
      <div className="sunset-sw-land" />
      <div className="sunset-sw-roadSide0">
        <div className="sunset-sw-roadSideGrid0" />
      </div>
      <div className="sunset-sw-roadSide1">
        <div className="sunset-sw-roadSideGrid1" />
      </div>
      <div className="sunset-sw-roadLines">
        <div className="sunset-sw-lines">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`sunset-sw-line${i}`} />
          ))}
        </div>
      </div>
      <div className="sunset-sw-car">
        <div className="sunset-sw-windowsSection" />
        <div className="sunset-sw-lightsSection">
          <div className="sunset-sw-lights0" />
          <div className="sunset-sw-lights1" />
          <div className="sunset-sw-lights2">
            <div className="sunset-sw-tailLight0">
              <div className="sunset-sw-tailLight0a" />
              <div className="sunset-sw-tailLight0b" />
              <div className="sunset-sw-tailLight0c" />
              <div className="sunset-sw-tailLight0d" />
              <div className="sunset-sw-cageLine0" />
              <div className="sunset-sw-cageLine1" />
            </div>
            <div className="sunset-sw-filler" />
            <div className="sunset-sw-tailLight1">
              <div className="sunset-sw-tailLight1a" />
              <div className="sunset-sw-tailLight1b" />
              <div className="sunset-sw-tailLight1c" />
              <div className="sunset-sw-tailLight1d" />
              <div className="sunset-sw-cageLine0" />
              <div className="sunset-sw-cageLine1" />
            </div>
          </div>
          <div className="sunset-sw-logo" />
          <div className="sunset-sw-window" />
          <div className="sunset-sw-sunReflection" />
          <div className="sunset-sw-lightStripe0" />
          <div className="sunset-sw-lightStripe1" />
          <div className="sunset-sw-lightStripe2" />
          <div className="sunset-sw-lightStripe3" />
        </div>
        <div className="sunset-sw-bumperSection">
          <div className="sunset-sw-bumper0" />
          <div className="sunset-sw-bumper1">
            <p>DELOREAN</p>
          </div>
          <div className="sunset-sw-bumper2" />
          <div className="sunset-sw-bumper3">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} />
            ))}
          </div>
          <div className="sunset-sw-exhaust0" />
          <div className="sunset-sw-exhaust1" />
        </div>
      </div>
      <div className="sunset-sw-fog2" />
      <div className="sunset-sw-cutout" />
    </div>
  )
}
